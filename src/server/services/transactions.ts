import { and, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  accounts,
  categories,
  transactions,
  transactionSplits,
  type Transaction,
  type TransactionSplit,
} from "@/db/schema";
import { inspectCurrencyCode, type AccountCurrencyState } from "@/lib/currency";
import { isValidIsoDate, isValidMonth, monthRange } from "@/lib/month";
import { transactionMatchesActiveCategory } from "./active-category";
import {
  invalidWriteInput,
  isSafeCents,
  MAX_SPLIT_PARTS,
  normalizeId,
  normalizeTransactionInput,
  normalizeTransactionTags,
  parseStoredTransactionTags,
  type InvalidWriteInput,
  type NormalizedTransactionInput,
  type TransactionInput,
} from "./write-validation";

export { normalizeTransactionInput } from "./write-validation";
export type { NormalizedTransactionInput, TransactionInput } from "./write-validation";

export interface TransactionListItem {
  id: string;
  date: string;
  description: string;
  notes: string;
  tags: string[];
  amountCents: number;
  accountId: string;
  accountName: string;
  rawCurrency: string;
  currency: string;
  normalizedCurrency: string | null;
  currencyState: AccountCurrencyState;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  isSplit: boolean; // has rows in transaction_splits — categoryId is then ignored
}

// Single source of the list projection + joins, shared by the paged query and
// getRecentTransactions (Q5). isSplit rides along as 0/1 (coerced to boolean by
// the callers) so the list can flag split rows without a second query.
const transactionListColumns = {
  id: transactions.id,
  date: transactions.date,
  description: transactions.description,
  notes: transactions.notes,
  tagsJson: transactions.tagsJson,
  amountCents: transactions.amountCents,
  accountId: transactions.accountId,
  accountName: accounts.name,
  rawCurrency: accounts.currency,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
  categoryColor: categories.color,
  isSplit: sql<number>`(exists (select 1 from ${transactionSplits} where ${transactionSplits.transactionId} = ${transactions.id}))`,
} as const;

type TransactionListRow = Omit<
  TransactionListItem,
  "currency" | "normalizedCurrency" | "currencyState" | "isSplit" | "tags"
> & {
  isSplit: number;
  tagsJson: string;
};

function toTransactionListItem(row: TransactionListRow): TransactionListItem {
  const currencyState = inspectCurrencyCode(row.rawCurrency);
  const { tagsJson, ...rest } = row;
  return {
    ...rest,
    tags: parseStoredTransactionTags(tagsJson),
    currency: row.rawCurrency,
    normalizedCurrency: currencyState.kind === "valid" ? currencyState.currency : null,
    currencyState,
    isSplit: row.isSplit > 0,
  };
}

export async function getRecentTransactions(
  limit = 10,
  db: Db = getDb(),
): Promise<TransactionListItem[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError("Invalid recent transaction limit");
  }
  const rows = await db
    .select(transactionListColumns)
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(limit);
  return rows.map(toTransactionListItem);
}

// The filterable predicate set, shared by the paged list and the CSV export.
export interface TransactionQuery {
  q?: string; // description/note/tag substring, case-insensitive
  tag?: string; // one exact canonical tag
  accountId?: string;
  categoryId?: string | null; // null = uncategorized, undefined = any
  month?: string; // YYYY-MM
  from?: string; // YYYY-MM-DD inclusive lower bound (F7)
  to?: string; // YYYY-MM-DD inclusive upper bound (F7)
}

export const TRANSACTIONS_PAGE_SIZE = 50;

export interface TransactionPageQuery extends TransactionQuery {
  requestedPage: number;
}

// Parse + validate the URL query shared by the transactions list and the CSV
// export so both apply identical filters. `get` returns the first value for a
// key (arrays already flattened by the caller). Invalid month/date bounds are
// dropped rather than erroring — a bad ?month= just means "no month filter".
export function parseTransactionQuery(
  get: (key: string) => string | null | undefined,
): TransactionQuery {
  const validDate = (v: string | null | undefined) =>
    v && isValidIsoDate(v) ? v : undefined;
  const rawMonth = get("month") || undefined;
  const rawCategory = get("category") || undefined;
  const rawTag = get("tag")?.trim();
  const tag = rawTag ? normalizeTransactionTags([rawTag])?.[0] : undefined;
  return {
    q: get("q")?.trim() || undefined,
    tag,
    accountId: get("account") || undefined,
    categoryId: rawCategory === "uncategorized" ? null : rawCategory,
    month: rawMonth && isValidMonth(rawMonth) ? rawMonth : undefined,
    from: validDate(get("from")),
    to: validDate(get("to")),
  };
}

export function transactionQuerySearchParams(query: TransactionQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.tag) params.set("tag", query.tag);
  if (query.accountId) params.set("account", query.accountId);
  if (query.categoryId === null) params.set("category", "uncategorized");
  else if (query.categoryId) params.set("category", query.categoryId);
  if (query.month) params.set("month", query.month);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return params;
}

export function transactionPageHref(query: TransactionQuery, page: number): string {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("Invalid canonical transaction page");
  }
  const params = transactionQuerySearchParams(query);
  if (page > 1) params.set("page", String(page));
  const queryString = params.toString();
  return queryString ? `/transactions?${queryString}` : "/transactions";
}

export interface ParsedTransactionPage {
  requestedPage: number;
  needsCanonicalRedirect: boolean;
}

// Only a plain positive safe integer can cross the URL-to-SQL pagination
// boundary. Invalid text canonicalizes to page 1 before the service is called.
export function parseTransactionPage(
  raw: string | null | undefined,
): ParsedTransactionPage {
  if (raw === null || raw === undefined) {
    return { requestedPage: 1, needsCanonicalRedirect: false };
  }
  if (raw.length > 16 || !/^[1-9][0-9]*$/.test(raw)) {
    return { requestedPage: 1, needsCanonicalRedirect: true };
  }
  const requestedPage = Number(raw);
  if (!Number.isSafeInteger(requestedPage)) {
    return { requestedPage: 1, needsCanonicalRedirect: true };
  }
  return { requestedPage, needsCanonicalRedirect: false };
}

export interface TransactionPage {
  items: TransactionListItem[];
  totalCount: number;
  page: number;
  lastPage: number;
}

export function buildTransactionWhere(filter: TransactionQuery): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.q) {
    // escape LIKE wildcards so the user searches literal text
    const escaped = filter.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = "%" + escaped + "%";
    conditions.push(
      or(
        sql`${transactions.description} LIKE ${pattern} ESCAPE '\\'`,
        sql`${transactions.notes} LIKE ${pattern} ESCAPE '\\'`,
        sql`exists (
          select 1
          from json_each(
            case
              when json_valid(${transactions.tagsJson})
              then case
                when json_type(${transactions.tagsJson}) = 'array'
                then ${transactions.tagsJson}
                else '[]'
              end
              else '[]'
            end
          ) as searched_tag
          where searched_tag.type = 'text'
            and searched_tag.value LIKE ${pattern} ESCAPE '\\'
        )`,
      )!,
    );
  }
  if (filter.tag) {
    conditions.push(sql`exists (
      select 1
      from json_each(
        case
          when json_valid(${transactions.tagsJson})
          then case
            when json_type(${transactions.tagsJson}) = 'array'
            then ${transactions.tagsJson}
            else '[]'
          end
          else '[]'
        end
      ) as transaction_tag
      where transaction_tag.type = 'text'
        and lower(trim(transaction_tag.value)) = ${filter.tag}
    )`);
  }
  if (filter.accountId) conditions.push(eq(transactions.accountId, filter.accountId));
  if (filter.categoryId === null || filter.categoryId) {
    conditions.push(transactionMatchesActiveCategory(filter.categoryId));
  }
  if (filter.month) {
    // range predicate hits transactions_date_idx (P1)
    const { start, endExclusive } = monthRange(filter.month);
    conditions.push(gte(transactions.date, start), lt(transactions.date, endExclusive));
  }
  // Date-only bounds; both inclusive since dates carry no time component. These
  // AND with `month` if a caller passes both — an intentional intersection.
  if (filter.from) conditions.push(gte(transactions.date, filter.from));
  if (filter.to) conditions.push(lte(transactions.date, filter.to));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function getTransactionCount(where: SQL | undefined, db: Db): Promise<number> {
  const [countRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .where(where);
  const count = countRow?.n ?? 0;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("Invalid transaction count");
  }
  return count;
}

export async function getUncategorizedTransactionCount(db: Db = getDb()): Promise<number> {
  return getTransactionCount(transactionMatchesActiveCategory(null), db);
}

export async function getTransactionsPage(
  filter: TransactionPageQuery,
  db: Db = getDb(),
): Promise<TransactionPage> {
  if (!Number.isSafeInteger(filter.requestedPage) || filter.requestedPage < 1) {
    throw new RangeError("Invalid requested transaction page");
  }
  const where = buildTransactionWhere(filter);
  const totalCount = await getTransactionCount(where, db);
  const lastPage = Math.max(1, Math.ceil(totalCount / TRANSACTIONS_PAGE_SIZE));
  const page = Math.min(filter.requestedPage, lastPage);
  const offset = (page - 1) * TRANSACTIONS_PAGE_SIZE;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("Invalid transaction page offset");
  }
  const rows = await db
    .select(transactionListColumns)
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(TRANSACTIONS_PAGE_SIZE)
    .offset(offset);
  const items = rows.map(toTransactionListItem);
  return { items, totalCount, page, lastPage };
}

export async function getLatestTransactionMonth(db: Db = getDb()): Promise<string | null> {
  // substr(max(date),1,7) uses the min/max index optimization; max(substr(...))
  // would scan (P1).
  const [row] = await db
    .select({ month: sql<string | null>`substr(max(${transactions.date}), 1, 7)` })
    .from(transactions);
  return row?.month ?? null;
}

export interface SplitMismatch {
  transactionId: string;
  parentAmountCents: number;
  // null means at least one stored amount, or the accumulated total, is not a
  // safe integer. Historical corruption is reported, never rounded.
  splitTotalCents: number | null;
}

export interface ExistingSplitMismatchResult {
  status: "existing-split-mismatch";
  parentAmountCents: number;
  splitTotalCents: number | null;
}

interface StoredSplitIntegrity {
  partCount: number;
  splitTotalCents: number | null;
  matchesParent: boolean;
}

function inspectStoredSplitAmounts(
  parentAmountCents: number,
  splitAmounts: readonly number[],
): StoredSplitIntegrity {
  if (splitAmounts.length === 0) {
    return { partCount: 0, splitTotalCents: 0, matchesParent: true };
  }

  let total = 0;
  for (const amountCents of splitAmounts) {
    if (!isSafeCents(amountCents)) {
      return { partCount: splitAmounts.length, splitTotalCents: null, matchesParent: false };
    }
    const next = total + amountCents;
    if (!Number.isSafeInteger(next)) {
      return { partCount: splitAmounts.length, splitTotalCents: null, matchesParent: false };
    }
    total = next;
  }
  return {
    partCount: splitAmounts.length,
    splitTotalCents: total,
    matchesParent: isSafeCents(parentAmountCents) && total === parentAmountCents,
  };
}

function readStoredSplitIntegrity(
  transactionId: string,
  parentAmountCents: number,
  db: Db,
): StoredSplitIntegrity {
  const rows = db
    .select({ amountCents: transactionSplits.amountCents })
    .from(transactionSplits)
    .where(eq(transactionSplits.transactionId, transactionId))
    .all();
  return inspectStoredSplitAmounts(
    parentAmountCents,
    rows.map((row) => row.amountCents),
  );
}

interface SplitAuditRow {
  transactionId: string;
  parentAmountCents: number;
  splitAmountCents: number;
}

function collectSplitMismatches(rows: readonly SplitAuditRow[]): SplitMismatch[] {
  const grouped = new Map<
    string,
    { parentAmountCents: number; splitAmounts: number[] }
  >();
  for (const row of rows) {
    const current = grouped.get(row.transactionId);
    if (current) current.splitAmounts.push(row.splitAmountCents);
    else {
      grouped.set(row.transactionId, {
        parentAmountCents: row.parentAmountCents,
        splitAmounts: [row.splitAmountCents],
      });
    }
  }

  const mismatches: SplitMismatch[] = [];
  for (const [transactionId, group] of grouped) {
    const integrity = inspectStoredSplitAmounts(group.parentAmountCents, group.splitAmounts);
    if (!integrity.matchesParent) {
      mismatches.push({
        transactionId,
        parentAmountCents: group.parentAmountCents,
        splitTotalCents: integrity.splitTotalCents,
      });
    }
  }
  return mismatches;
}

function readSplitAuditRows(db: Db, transactionIds?: readonly string[]): SplitAuditRow[] {
  const query = db
    .select({
      transactionId: transactions.id,
      parentAmountCents: transactions.amountCents,
      splitAmountCents: transactionSplits.amountCents,
    })
    .from(transactionSplits)
    .innerJoin(transactions, eq(transactionSplits.transactionId, transactions.id));
  if (transactionIds === undefined) return query.all();
  if (transactionIds.length === 0) return [];
  return query.where(inArray(transactions.id, [...transactionIds])).all();
}

// Maintenance-only audit. Callers decide how to present the local IDs; this
// service does not log or participate in public health checks.
export async function getSplitMismatches(db: Db = getDb()): Promise<SplitMismatch[]> {
  return collectSplitMismatches(readSplitAuditRows(db));
}

// Internal write-path helper exported for the category-rule service. Keep each
// IN-list below SQLite's conservative compatibility ceiling.
export function findFirstSplitMismatch(
  transactionIds: readonly string[],
  db: Db,
): SplitMismatch | null {
  const chunkSize = 500;
  for (let index = 0; index < transactionIds.length; index += chunkSize) {
    const mismatches = collectSplitMismatches(
      readSplitAuditRows(db, transactionIds.slice(index, index + chunkSize)),
    );
    if (mismatches[0]) return mismatches[0];
  }
  return null;
}

export type SetTransactionCategoryResult =
  | { status: "updated"; id: string }
  | { status: "not-found" }
  | { status: "unknown-category" }
  | ExistingSplitMismatchResult
  | InvalidWriteInput;

export async function setTransactionCategory(
  transactionId: string,
  categoryId: string | null,
  db: Db = getDb(),
): Promise<SetTransactionCategoryResult> {
  const normalizedTransactionId = normalizeId(transactionId);
  if (!normalizedTransactionId) {
    return invalidWriteInput("transactionId", "Invalid transaction id");
  }
  const normalizedCategoryId = categoryId === null ? null : normalizeId(categoryId);
  if (categoryId !== null && !normalizedCategoryId) {
    return invalidWriteInput("categoryId", "Invalid category id");
  }

  return db.transaction(
    (tx) => {
      const transaction = tx
        .select({ id: transactions.id, amountCents: transactions.amountCents })
        .from(transactions)
        .where(eq(transactions.id, normalizedTransactionId))
        .limit(1)
        .get();
      if (!transaction) return { status: "not-found" as const };

      const splitIntegrity = readStoredSplitIntegrity(
        transaction.id,
        transaction.amountCents,
        tx,
      );
      if (splitIntegrity.partCount > 0 && !splitIntegrity.matchesParent) {
        return {
          status: "existing-split-mismatch" as const,
          parentAmountCents: transaction.amountCents,
          splitTotalCents: splitIntegrity.splitTotalCents,
        };
      }

      if (normalizedCategoryId) {
        const category = tx
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.id, normalizedCategoryId))
          .limit(1)
          .get();
        if (!category) return { status: "unknown-category" as const };
      }

      const row = tx
        .update(transactions)
        .set({ categoryId: normalizedCategoryId })
        .where(eq(transactions.id, normalizedTransactionId))
        .returning({ id: transactions.id })
        .get();
      if (!row) throw new Error("transaction disappeared during recategorization");
      return { status: "updated" as const, id: row.id };
    },
    { behavior: "immediate" },
  );
}

// ---------- manual transaction CRUD (importHash stays null) ----------

type TransactionReferenceFailure =
  | { status: "unknown-account" }
  | { status: "unknown-category" };

function validateTransactionReferences(
  input: NormalizedTransactionInput,
  db: Db,
): TransactionReferenceFailure | null {
  const account = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, input.accountId))
    .limit(1)
    .get();
  if (!account) return { status: "unknown-account" };
  if (input.categoryId) {
    const category = db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, input.categoryId))
      .limit(1)
      .get();
    if (!category) return { status: "unknown-category" };
  }
  return null;
}

export type CreateTransactionResult =
  | { status: "created"; transaction: Transaction }
  | TransactionReferenceFailure
  | InvalidWriteInput;

export async function createTransaction(
  input: TransactionInput,
  db: Db = getDb(),
): Promise<CreateTransactionResult> {
  const normalized = normalizeTransactionInput(input);
  if (!normalized.ok) return normalized.result;

  return db.transaction(
    (tx) => {
      const referenceFailure = validateTransactionReferences(normalized.value, tx);
      if (referenceFailure) return referenceFailure;
      const transaction = tx.insert(transactions).values(normalized.value).returning().get();
      if (!transaction) throw new Error("failed to create transaction");
      return { status: "created" as const, transaction };
    },
    { behavior: "immediate" },
  );
}

export type UpdateTransactionResult =
  | { status: "updated"; id: string }
  | { status: "not-found" }
  | ExistingSplitMismatchResult
  | {
      status: "split-amount-conflict";
      currentAmountCents: number;
      splitTotalCents: number;
    }
  | TransactionReferenceFailure
  | InvalidWriteInput;

export async function updateTransaction(
  id: string,
  input: TransactionInput,
  db: Db = getDb(),
): Promise<UpdateTransactionResult> {
  const normalizedId = normalizeId(id);
  if (!normalizedId) return invalidWriteInput("id", "Invalid transaction id");
  const normalized = normalizeTransactionInput(input);
  if (!normalized.ok) return normalized.result;

  return db.transaction(
    (tx) => {
      const current = tx
        .select({ id: transactions.id, amountCents: transactions.amountCents })
        .from(transactions)
        .where(eq(transactions.id, normalizedId))
        .limit(1)
        .get();
      if (!current) return { status: "not-found" as const };

      const splitIntegrity = readStoredSplitIntegrity(current.id, current.amountCents, tx);
      if (splitIntegrity.partCount > 0 && !splitIntegrity.matchesParent) {
        return {
          status: "existing-split-mismatch" as const,
          parentAmountCents: current.amountCents,
          splitTotalCents: splitIntegrity.splitTotalCents,
        };
      }
      if (
        splitIntegrity.partCount > 0 &&
        normalized.value.amountCents !== current.amountCents
      ) {
        // A matching split total is necessarily safe here.
        if (splitIntegrity.splitTotalCents === null) {
          throw new Error("valid split integrity unexpectedly had an unsafe total");
        }
        return {
          status: "split-amount-conflict" as const,
          currentAmountCents: current.amountCents,
          splitTotalCents: splitIntegrity.splitTotalCents,
        };
      }

      const referenceFailure = validateTransactionReferences(normalized.value, tx);
      if (referenceFailure) return referenceFailure;
      const row = tx
        .update(transactions)
        .set(normalized.value)
        .where(eq(transactions.id, normalizedId))
        .returning({ id: transactions.id })
        .get();
      if (!row) throw new Error("transaction disappeared during update");
      return { status: "updated" as const, id: row.id };
    },
    { behavior: "immediate" },
  );
}

export async function deleteTransaction(id: string, db: Db = getDb()): Promise<string | null> {
  const [row] = await db
    .delete(transactions)
    .where(eq(transactions.id, id))
    .returning({ id: transactions.id });
  return row?.id ?? null;
}

export async function getTransactionById(id: string, db: Db = getDb()) {
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  if (!row) return null;
  const { tagsJson, ...transaction } = row;
  return { ...transaction, tags: parseStoredTransactionTags(tagsJson) };
}

// ---------- transaction splits ----------

export interface SplitInput {
  categoryId: string | null;
  amountCents: number; // signed; same convention as transactions
}

interface NormalizedSplitInput {
  categoryId: string | null;
  amountCents: number;
}

function normalizeSplitInputs(
  parts: SplitInput[],
): { ok: true; value: NormalizedSplitInput[] } | { ok: false; result: InvalidWriteInput } {
  if (!Array.isArray(parts)) {
    return { ok: false, result: invalidWriteInput("parts", "Invalid split parts") };
  }
  if (parts.length > MAX_SPLIT_PARTS) {
    return {
      ok: false,
      result: invalidWriteInput(
        "parts",
        `A split cannot contain more than ${MAX_SPLIT_PARTS} parts`,
      ),
    };
  }
  const normalized: NormalizedSplitInput[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") {
      return { ok: false, result: invalidWriteInput("parts", "Invalid split part") };
    }
    const categoryId = part.categoryId === null ? null : normalizeId(part.categoryId);
    if (part.categoryId !== null && !categoryId) {
      return { ok: false, result: invalidWriteInput("categoryId", "Invalid category id") };
    }
    if (!isSafeCents(part.amountCents)) {
      return {
        ok: false,
        result: invalidWriteInput("amountCents", "Split amount must be exact cents"),
      };
    }
    normalized.push({ categoryId, amountCents: part.amountCents });
  }
  return { ok: true, value: normalized };
}

export async function getSplitsForTransaction(
  transactionId: string,
  db: Db = getDb(),
): Promise<TransactionSplit[]> {
  return db
    .select()
    .from(transactionSplits)
    .where(eq(transactionSplits.transactionId, transactionId));
}

export type ReplaceSplitsResult =
  | { status: "updated" }
  | { status: "unchanged" }
  | { status: "not-found" }
  | { status: "unknown-category" }
  | {
      status: "split-total-mismatch";
      parentAmountCents: number;
      splitTotalCents: number;
    }
  | InvalidWriteInput;

// Replace every split for a transaction in one write-reserving transaction.
// Empty `parts` explicitly clears the split, reverting to the parent category.
export async function replaceSplits(
  transactionId: string,
  parts: SplitInput[],
  db: Db = getDb(),
): Promise<ReplaceSplitsResult> {
  const normalizedTransactionId = normalizeId(transactionId);
  if (!normalizedTransactionId) {
    return invalidWriteInput("transactionId", "Invalid transaction id");
  }
  const normalized = normalizeSplitInputs(parts);
  if (!normalized.ok) return normalized.result;

  return db.transaction(
    (tx) => {
      const parent = tx
        .select({ id: transactions.id, amountCents: transactions.amountCents })
        .from(transactions)
        .where(eq(transactions.id, normalizedTransactionId))
        .limit(1)
        .get();
      if (!parent) return { status: "not-found" as const };

      if (normalized.value.length === 0) {
        const result = tx.delete(transactionSplits)
          .where(eq(transactionSplits.transactionId, normalizedTransactionId))
          .run();
        return result.changes > 0
          ? { status: "updated" as const }
          : { status: "unchanged" as const };
      }
      if (normalized.value.length < 2) {
        return invalidWriteInput("parts", "A split needs at least two parts");
      }

      let splitTotalCents = 0;
      for (const part of normalized.value) {
        if (part.amountCents === 0) {
          return invalidWriteInput("amountCents", "A split part cannot be zero");
        }
        const next = splitTotalCents + part.amountCents;
        if (!Number.isSafeInteger(next)) {
          return invalidWriteInput("parts", "Split total is outside the safe cents range");
        }
        splitTotalCents = next;
      }
      if (splitTotalCents !== parent.amountCents) {
        return {
          status: "split-total-mismatch" as const,
          parentAmountCents: parent.amountCents,
          splitTotalCents,
        };
      }

      const categoryIds = [
        ...new Set(
          normalized.value.flatMap((part) => (part.categoryId ? [part.categoryId] : [])),
        ),
      ];
      if (categoryIds.length > 0) {
        const found = tx
          .select({ id: categories.id })
          .from(categories)
          .where(inArray(categories.id, categoryIds))
          .all();
        if (found.length !== categoryIds.length) return { status: "unknown-category" as const };
      }

      tx.delete(transactionSplits)
        .where(eq(transactionSplits.transactionId, normalizedTransactionId))
        .run();
      tx.insert(transactionSplits)
        .values(
          normalized.value.map((part) => ({
            transactionId: normalizedTransactionId,
            categoryId: part.categoryId,
            amountCents: part.amountCents,
          })),
        )
        .run();
      return { status: "updated" as const };
    },
    { behavior: "immediate" },
  );
}
