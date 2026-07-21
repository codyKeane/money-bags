import { and, eq, or, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  accounts,
  refundLinks,
  transactions,
  transferPairs,
} from "@/db/schema";
import { inspectCurrencyCode } from "@/lib/currency";
import { isValidIsoDate } from "@/lib/month";
import { invalidWriteInput, isSafeCents, normalizeId, type InvalidWriteInput } from "./write-validation";

const TRANSFER_DATE_WINDOW_DAYS = 3;

function dateOrdinal(value: string): number {
  if (!isValidIsoDate(value)) return Number.NaN;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return Math.trunc(Date.UTC(year, month - 1, day) / 86_400_000);
}

function withinTransferWindow(left: string, right: string): boolean {
  const delta = Math.abs(dateOrdinal(left) - dateOrdinal(right));
  return Number.isSafeInteger(delta) && delta <= TRANSFER_DATE_WINDOW_DAYS;
}

function absoluteCents(value: number): number | null {
  if (!isSafeCents(value)) return null;
  const result = Math.abs(value);
  return Number.isSafeInteger(result) ? result : null;
}

interface LinkTransactionRow {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  accountId: string;
  accountName: string;
  rawCurrency: string;
}

function readLinkTransaction(id: string, db: Db): LinkTransactionRow | null {
  return (
    db
      .select({
        id: transactions.id,
        date: transactions.date,
        description: transactions.description,
        amountCents: transactions.amountCents,
        accountId: transactions.accountId,
        accountName: accounts.name,
        rawCurrency: accounts.currency,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(eq(transactions.id, id))
      .limit(1)
      .get() ?? null
  );
}

function hasTransferLink(id: string, db: Db): boolean {
  return Boolean(
    db
      .select({ id: transferPairs.id })
      .from(transferPairs)
      .where(
        or(
          eq(transferPairs.sourceTransactionId, id),
          eq(transferPairs.destinationTransactionId, id),
        ),
      )
      .limit(1)
      .get(),
  );
}

function hasRefundLink(id: string, db: Db): boolean {
  return Boolean(
    db
      .select({ id: refundLinks.id })
      .from(refundLinks)
      .where(
        or(
          eq(refundLinks.refundTransactionId, id),
          eq(refundLinks.originalTransactionId, id),
        ),
      )
      .limit(1)
      .get(),
  );
}

export interface TransferCandidate {
  source: LinkTransactionRow;
  destination: LinkTransactionRow;
  dateDistanceDays: number;
  currency: string;
}

export async function getTransferCandidates(
  limit = 100,
  db: Db = getDb(),
): Promise<TransferCandidate[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError("Invalid transfer candidate limit");
  }
  const rows = db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amountCents: transactions.amountCents,
      accountId: transactions.accountId,
      accountName: accounts.name,
      rawCurrency: accounts.currency,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(sql`${transactions.amountCents} <> 0`)
    .all();
  const candidates: TransferCandidate[] = [];
  const positiveByKey = new Map<string, LinkTransactionRow[]>();
  for (const row of rows) {
    if (
      row.amountCents <= 0 ||
      !isSafeCents(row.amountCents) ||
      hasTransferLink(row.id, db) ||
      hasRefundLink(row.id, db)
    ) continue;
    const currencyState = inspectCurrencyCode(row.rawCurrency);
    if (currencyState.kind !== "valid") continue;
    const key = `${currencyState.currency}:${row.amountCents}`;
    const group = positiveByKey.get(key);
    if (group) group.push(row);
    else positiveByKey.set(key, [row]);
  }

  const seen = new Set<string>();
  for (const row of rows) {
    if (row.amountCents >= 0 || hasTransferLink(row.id, db) || hasRefundLink(row.id, db)) continue;
    const currencyState = inspectCurrencyCode(row.rawCurrency);
    const magnitude = absoluteCents(row.amountCents);
    if (currencyState.kind !== "valid" || magnitude === null) continue;
    const matches = positiveByKey.get(`${currencyState.currency}:${magnitude}`) ?? [];
    for (const destination of matches) {
      if (destination.accountId === row.accountId || !withinTransferWindow(row.date, destination.date)) {
        continue;
      }
      const pairKey = [row.id, destination.id].sort().join(":");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      candidates.push({
        source: row,
        destination,
        dateDistanceDays: Math.abs(dateOrdinal(row.date) - dateOrdinal(destination.date)),
        currency: currencyState.currency,
      });
    }
  }
  return candidates
    .sort((a, b) =>
      a.dateDistanceDays - b.dateDistanceDays ||
      Math.abs(a.source.amountCents) - Math.abs(b.source.amountCents) ||
      a.source.date.localeCompare(b.source.date),
    )
    .slice(0, limit);
}

export type PairTransferResult =
  | { status: "paired"; id: string }
  | { status: "not-found" }
  | { status: "invalid-candidate"; message: string }
  | { status: "already-linked" }
  | { status: "conflict" }
  | InvalidWriteInput;

export async function pairTransferTransactions(
  firstId: string,
  secondId: string,
  db: Db = getDb(),
): Promise<PairTransferResult> {
  const sourceId = normalizeId(firstId);
  const destinationId = normalizeId(secondId);
  if (!sourceId || !destinationId) return invalidWriteInput("transactionId", "Invalid transaction id");
  if (sourceId === destinationId) {
    return { status: "invalid-candidate", message: "A transaction cannot be paired with itself." };
  }
  return db.transaction((tx) => {
    const first = readLinkTransaction(sourceId, tx);
    const second = readLinkTransaction(destinationId, tx);
    if (!first || !second) return { status: "not-found" as const };
    const firstCurrency = inspectCurrencyCode(first.rawCurrency);
    const secondCurrency = inspectCurrencyCode(second.rawCurrency);
    const firstMagnitude = absoluteCents(first.amountCents);
    const secondMagnitude = absoluteCents(second.amountCents);
    if (
      first.accountId === second.accountId ||
      first.amountCents >= 0 ||
      second.amountCents <= 0 ||
      firstMagnitude === null ||
      firstMagnitude !== secondMagnitude ||
      firstCurrency.kind !== "valid" ||
      secondCurrency.kind !== "valid" ||
      firstCurrency.currency !== secondCurrency.currency ||
      !withinTransferWindow(first.date, second.date)
    ) {
      return {
        status: "invalid-candidate" as const,
        message: "Transfers need equal opposite cents, different same-currency accounts, and dates within three days.",
      };
    }
    if (hasTransferLink(first.id, tx) || hasTransferLink(second.id, tx)) {
      return { status: "already-linked" as const };
    }
    if (hasRefundLink(first.id, tx) || hasRefundLink(second.id, tx)) {
      return { status: "conflict" as const };
    }
    const pair = tx
      .insert(transferPairs)
      .values({ sourceTransactionId: first.id, destinationTransactionId: second.id })
      .returning({ id: transferPairs.id })
      .get();
    if (!pair) throw new Error("Failed to pair transfer transactions");
    return { status: "paired" as const, id: pair.id };
  }, { behavior: "immediate" });
}

export async function unpairTransferTransaction(
  transactionId: string,
  db: Db = getDb(),
): Promise<{ status: "unpaired" | "not-found" | "not-linked" } | InvalidWriteInput> {
  const id = normalizeId(transactionId);
  if (!id) return invalidWriteInput("transactionId", "Invalid transaction id");
  const result = await db
    .delete(transferPairs)
    .where(or(eq(transferPairs.sourceTransactionId, id), eq(transferPairs.destinationTransactionId, id)))
    .returning({ id: transferPairs.id })
    .all();
  if (result.length > 0) return { status: "unpaired" };
  const exists = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, id)).limit(1).get();
  return exists ? { status: "not-linked" } : { status: "not-found" };
}

export interface RefundCandidate extends LinkTransactionRow {
  remainingRefundCents: number;
}

export async function getRefundCandidates(
  refundTransactionId: string,
  limit = 100,
  db: Db = getDb(),
): Promise<RefundCandidate[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError("Invalid refund candidate limit");
  }
  const refundId = normalizeId(refundTransactionId);
  if (!refundId) return [];
  const refund = readLinkTransaction(refundId, db);
  if (!refund || refund.amountCents <= 0) return [];
  const currency = inspectCurrencyCode(refund.rawCurrency);
  if (currency.kind !== "valid") return [];
  const rows = db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amountCents: transactions.amountCents,
      accountId: transactions.accountId,
      accountName: accounts.name,
      rawCurrency: accounts.currency,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(transactions.accountId, refund.accountId), sql`${transactions.amountCents} < 0`))
    .orderBy(sql`${transactions.date} desc`)
    .limit(limit)
    .all();
  return rows.flatMap((original) => {
    if (hasTransferLink(original.id, db)) return [];
    const originalCurrency = inspectCurrencyCode(original.rawCurrency);
    if (originalCurrency.kind !== "valid" || originalCurrency.currency !== currency.currency) return [];
    const originalMagnitude = absoluteCents(original.amountCents);
    if (originalMagnitude === null) return [];
    const refunded = db
      .select({ amountCents: transactions.amountCents })
      .from(refundLinks)
      .innerJoin(transactions, eq(refundLinks.refundTransactionId, transactions.id))
      .where(eq(refundLinks.originalTransactionId, original.id))
      .all();
    let alreadyRefunded = 0;
    for (const row of refunded) {
      const next = alreadyRefunded + row.amountCents;
      if (!Number.isSafeInteger(next)) return [];
      alreadyRefunded = next;
    }
    const remainingRefundCents = originalMagnitude - alreadyRefunded;
    return remainingRefundCents > 0
      ? [{ ...original, remainingRefundCents }]
      : [];
  });
}

export type LinkRefundResult =
  | { status: "linked"; id: string }
  | { status: "not-found" }
  | { status: "invalid-candidate"; message: string }
  | { status: "already-linked" }
  | InvalidWriteInput;

export async function linkRefund(
  refundTransactionId: string,
  originalTransactionId: string,
  db: Db = getDb(),
): Promise<LinkRefundResult> {
  const refundId = normalizeId(refundTransactionId);
  const originalId = normalizeId(originalTransactionId);
  if (!refundId || !originalId) return invalidWriteInput("transactionId", "Invalid transaction id");
  if (refundId === originalId) {
    return { status: "invalid-candidate", message: "A refund cannot point to itself." };
  }
  return db.transaction((tx) => {
    const refund = readLinkTransaction(refundId, tx);
    const original = readLinkTransaction(originalId, tx);
    if (!refund || !original) return { status: "not-found" as const };
    const refundCurrency = inspectCurrencyCode(refund.rawCurrency);
    const originalCurrency = inspectCurrencyCode(original.rawCurrency);
    const refundAmount = absoluteCents(refund.amountCents);
    const originalAmount = absoluteCents(original.amountCents);
    if (
      refund.amountCents <= 0 ||
      original.amountCents >= 0 ||
      refund.accountId !== original.accountId ||
      refundCurrency.kind !== "valid" ||
      originalCurrency.kind !== "valid" ||
      refundCurrency.currency !== originalCurrency.currency ||
      refundAmount === null ||
      originalAmount === null
    ) {
      return { status: "invalid-candidate" as const, message: "Refunds need a positive row and a same-account negative original with a valid matching currency." };
    }
    if (hasTransferLink(refund.id, tx) || hasTransferLink(original.id, tx)) {
      return { status: "invalid-candidate" as const, message: "Transfer-linked transactions cannot also be refunds." };
    }
    const existingRefund = tx
      .select({ id: refundLinks.id })
      .from(refundLinks)
      .where(eq(refundLinks.refundTransactionId, refund.id))
      .limit(1)
      .get();
    if (existingRefund) return { status: "already-linked" as const };
    const totalAlreadyRefunded = tx
      .select({ total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)` })
      .from(refundLinks)
      .innerJoin(transactions, eq(refundLinks.refundTransactionId, transactions.id))
      .where(eq(refundLinks.originalTransactionId, original.id))
      .get()?.total ?? 0;
    if (!isSafeCents(totalAlreadyRefunded) || refundAmount > originalAmount - totalAlreadyRefunded) {
      return { status: "invalid-candidate" as const, message: "Linked refunds cannot exceed the original outflow." };
    }
    const row = tx
      .insert(refundLinks)
      .values({ refundTransactionId: refund.id, originalTransactionId: original.id })
      .returning({ id: refundLinks.id })
      .get();
    if (!row) throw new Error("Failed to link refund");
    return { status: "linked" as const, id: row.id };
  }, { behavior: "immediate" });
}

export async function unlinkRefund(
  refundTransactionId: string,
  db: Db = getDb(),
): Promise<{ status: "unlinked" | "not-found" | "not-linked" } | InvalidWriteInput> {
  const id = normalizeId(refundTransactionId);
  if (!id) return invalidWriteInput("transactionId", "Invalid transaction id");
  const result = await db
    .delete(refundLinks)
    .where(eq(refundLinks.refundTransactionId, id))
    .returning({ id: refundLinks.id })
    .all();
  if (result.length > 0) return { status: "unlinked" };
  const exists = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, id)).limit(1).get();
  return exists ? { status: "not-linked" } : { status: "not-found" };
}

export interface TransactionLinkState {
  transferPairId: string | null;
  refundOriginalTransactionId: string | null;
  refundTransactionIds: string[];
}

export async function getTransactionLinkState(
  transactionId: string,
  db: Db = getDb(),
): Promise<TransactionLinkState> {
  const transfer = db
    .select({ id: transferPairs.id })
    .from(transferPairs)
    .where(or(eq(transferPairs.sourceTransactionId, transactionId), eq(transferPairs.destinationTransactionId, transactionId)))
    .limit(1)
    .get();
  const refund = db
    .select({ originalId: refundLinks.originalTransactionId })
    .from(refundLinks)
    .where(eq(refundLinks.refundTransactionId, transactionId))
    .limit(1)
    .get();
  const refunds = db
    .select({ id: refundLinks.refundTransactionId })
    .from(refundLinks)
    .where(eq(refundLinks.originalTransactionId, transactionId))
    .all();
  return {
    transferPairId: transfer?.id ?? null,
    refundOriginalTransactionId: refund?.originalId ?? null,
    refundTransactionIds: refunds.map((row) => row.id),
  };
}
