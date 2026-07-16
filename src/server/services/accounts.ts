import { eq, sql } from "drizzle-orm";
import { getDb, type Db } from "../../db/client";
import { accounts, transactions, type Account } from "../../db/schema";
import type { AccountType } from "../../lib/account-types";
import {
  deriveCurrencyState,
  inspectCurrencyCode,
  type AccountCurrencyState,
  type CurrencyState,
} from "../../lib/currency";
import {
  invalidWriteInput,
  isSafeCents,
  normalizeAccountName,
  normalizeAccountType,
  normalizeCurrencyCode,
  normalizeId,
  normalizeInstitution,
  type InvalidWriteInput,
} from "./write-validation";

export interface AccountWithBalance {
  id: string;
  name: string;
  type: string;
  institution: string | null;
  rawCurrency: string;
  currency: string;
  normalizedCurrency: string | null;
  currencyState: AccountCurrencyState;
  openingBalanceCents: number;
  balanceCents: number | null;
  balanceState: { kind: "ready" } | { kind: "unsafe" };
  transactionCount: number;
}

export async function getAccountsWithBalances(db: Db = getDb()): Promise<AccountWithBalance[]> {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      institution: accounts.institution,
      rawCurrency: accounts.currency,
      openingBalanceCents: accounts.openingBalanceCents,
      rawBalanceCents: sql<number>`${accounts.openingBalanceCents} + coalesce(sum(${transactions.amountCents}), 0)`,
      transactionCount: sql<number>`count(${transactions.id})`,
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .groupBy(accounts.id)
    .orderBy(accounts.name);

  return rows.map(({ rawBalanceCents, ...row }) => {
    const balanceIsSafe = Number.isSafeInteger(rawBalanceCents);
    const currencyState = inspectCurrencyCode(row.rawCurrency);
    return {
      ...row,
      currency: row.rawCurrency,
      normalizedCurrency: currencyState.kind === "valid" ? currencyState.currency : null,
      currencyState,
      balanceCents: balanceIsSafe ? rawBalanceCents : null,
      balanceState: balanceIsSafe ? { kind: "ready" } : { kind: "unsafe" },
    };
  });
}

function sumAccountBalances(rows: AccountWithBalance[]): number | null {
  let total = BigInt(0);
  for (const account of rows) {
    if (account.balanceCents === null || account.balanceState.kind !== "ready") return null;
    total += BigInt(account.balanceCents);
  }
  const netWorthCents = Number(total);
  return Number.isSafeInteger(netWorthCents) ? netWorthCents : null;
}

export function sumNetWorth(rows: AccountWithBalance[]): number | null {
  const currencyState = deriveCurrencyState(
    rows.map((row) => ({ id: row.id, name: row.name, rawCurrency: row.rawCurrency })),
  );
  return currencyState.kind === "single" ? sumAccountBalances(rows) : null;
}

export async function getNetWorth(db: Db = getDb()): Promise<number | null> {
  return (await getNetWorthOverview(db)).netWorthCents;
}

export interface NetWorthOverview {
  netWorthCents: number | null;
  currencyState: CurrencyState;
  aggregateState: { kind: "ready" } | { kind: "unavailable" } | { kind: "unsafe" };
}

// A combined total is meaningful only when every account has one valid shared
// currency and the exact cent sum remains a JavaScript safe integer.
export function buildNetWorthOverview(rows: AccountWithBalance[]): NetWorthOverview {
  const currencyState = deriveCurrencyState(
    rows.map((row) => ({ id: row.id, name: row.name, rawCurrency: row.rawCurrency })),
  );
  if (currencyState.kind !== "single") {
    return { netWorthCents: null, currencyState, aggregateState: { kind: "unavailable" } };
  }
  const netWorthCents = sumAccountBalances(rows);
  return netWorthCents === null
    ? { netWorthCents: null, currencyState, aggregateState: { kind: "unsafe" } }
    : { netWorthCents, currencyState, aggregateState: { kind: "ready" } };
}

export async function getNetWorthOverview(db: Db = getDb()): Promise<NetWorthOverview> {
  return buildNetWorthOverview(await getAccountsWithBalances(db));
}

// Lightweight account list for dropdowns — avoids the per-account balance
// aggregate on pages that only need names (P3).
export interface AccountOption {
  id: string;
  name: string;
  type: string;
  rawCurrency: string;
  currency: string;
  normalizedCurrency: string | null;
  currencyState: AccountCurrencyState;
}

export async function getAccountOptions(db: Db = getDb()): Promise<AccountOption[]> {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      rawCurrency: accounts.currency,
    })
    .from(accounts)
    .orderBy(accounts.name);
  return rows.map((row) => {
    const currencyState = inspectCurrencyCode(row.rawCurrency);
    return {
      ...row,
      currency: row.rawCurrency,
      normalizedCurrency: currencyState.kind === "valid" ? currencyState.currency : null,
      currencyState,
    };
  });
}

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  institution?: string | null;
  currency: string;
  openingBalanceCents?: number;
}

export interface NormalizedAccountInput {
  name: string;
  type: AccountType;
  institution: string | null;
  currency: string;
  openingBalanceCents: number;
}

export type CreateAccountResult =
  | { status: "created"; account: Account }
  | { status: "duplicate-name" }
  | InvalidWriteInput;

export function normalizeCreateAccountInput(
  input: CreateAccountInput,
): { ok: true; value: NormalizedAccountInput } | { ok: false; result: InvalidWriteInput } {
  const name = normalizeAccountName(input.name);
  if (!name) {
    return { ok: false, result: invalidWriteInput("name", "Account name is required") };
  }
  const type = normalizeAccountType(input.type);
  if (!type) {
    return { ok: false, result: invalidWriteInput("type", "Unknown account type") };
  }
  const institution = normalizeInstitution(input.institution);
  if (institution === undefined) {
    return { ok: false, result: invalidWriteInput("institution", "Invalid institution") };
  }
  const currency = normalizeCurrencyCode(input.currency);
  if (!currency) {
    return { ok: false, result: invalidWriteInput("currency", "Invalid currency") };
  }
  const openingBalanceCents = input.openingBalanceCents ?? 0;
  if (!isSafeCents(openingBalanceCents)) {
    return {
      ok: false,
      result: invalidWriteInput("openingBalanceCents", "Opening balance must be exact cents"),
    };
  }
  return {
    ok: true,
    value: { name, type, institution, currency, openingBalanceCents },
  };
}

export async function createAccount(
  input: CreateAccountInput,
  db: Db = getDb(),
): Promise<CreateAccountResult> {
  const normalized = normalizeCreateAccountInput(input);
  if (!normalized.ok) return normalized.result;

  const row = await db
    .insert(accounts)
    .values(normalized.value)
    .onConflictDoNothing({ target: accounts.name })
    .returning()
    .get();
  return row ? { status: "created", account: row } : { status: "duplicate-name" };
}

export async function getAccountByName(name: string, db: Db = getDb()) {
  const [row] = await db.select().from(accounts).where(eq(accounts.name, name)).limit(1);
  return row ?? null;
}

export async function getOrCreateAccountByName(
  name: string,
  type: AccountType,
  currency: string,
  db: Db = getDb(),
): Promise<
  | { status: "created"; account: Account; created: true }
  | { status: "existing"; account: Account; created: false }
  | InvalidWriteInput
> {
  const normalized = normalizeCreateAccountInput({ name, type, currency });
  if (!normalized.ok) return normalized.result;

  return db.transaction(
    (tx) => {
      const existing = tx
        .select()
        .from(accounts)
        .where(eq(accounts.name, normalized.value.name))
        .limit(1)
        .get();
      if (existing) return { status: "existing" as const, account: existing, created: false };

      const account = tx.insert(accounts).values(normalized.value).returning().get();
      if (!account) throw new Error("failed to create account");
      return { status: "created" as const, account, created: true };
    },
    { behavior: "immediate" },
  );
}

export async function getAccountById(id: string, db: Db = getDb()) {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return row
    ? {
        ...row,
        rawCurrency: row.currency,
        currencyState: inspectCurrencyCode(row.currency),
      }
    : null;
}

export interface UpdateAccountInput {
  name: string;
  type: AccountType;
  institution: string | null;
  currency: string;
  openingBalanceCents: number;
}

export type UpdateAccountResult =
  | { status: "updated"; id: string }
  | { status: "not-found" }
  | { status: "duplicate-name" }
  | InvalidWriteInput;

export async function updateAccount(
  id: string,
  input: UpdateAccountInput,
  db: Db = getDb(),
): Promise<UpdateAccountResult> {
  const normalizedId = normalizeId(id);
  if (!normalizedId) return invalidWriteInput("id", "Invalid account id");
  const normalized = normalizeCreateAccountInput(input);
  if (!normalized.ok) return normalized.result;

  return db.transaction(
    (tx) => {
      const current = tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, normalizedId))
        .limit(1)
        .get();
      if (!current) return { status: "not-found" as const };

      const nameOwner = tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.name, normalized.value.name))
        .limit(1)
        .get();
      if (nameOwner && nameOwner.id !== normalizedId) {
        return { status: "duplicate-name" as const };
      }

      const row = tx
        .update(accounts)
        .set(normalized.value)
        .where(eq(accounts.id, normalizedId))
        .returning({ id: accounts.id })
        .get();
      if (!row) throw new Error("account disappeared during update");
      return { status: "updated" as const, id: row.id };
    },
    { behavior: "immediate" },
  );
}

// FK cascade removes the account's transactions with it — callers gate this
// behind an explicit typed confirmation.
export async function deleteAccount(id: string, db: Db = getDb()): Promise<string | null> {
  const [row] = await db
    .delete(accounts)
    .where(eq(accounts.id, id))
    .returning({ id: accounts.id });
  return row?.id ?? null;
}
