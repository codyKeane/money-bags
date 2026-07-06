import { eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { accounts, transactions } from "@/db/schema";
import type { AccountType } from "@/lib/account-types";

export interface AccountWithBalance {
  id: string;
  name: string;
  type: string;
  institution: string | null;
  currency: string;
  openingBalanceCents: number;
  balanceCents: number;
  transactionCount: number;
}

export async function getAccountsWithBalances(db: Db = getDb()): Promise<AccountWithBalance[]> {
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      institution: accounts.institution,
      currency: accounts.currency,
      openingBalanceCents: accounts.openingBalanceCents,
      balanceCents: sql<number>`${accounts.openingBalanceCents} + coalesce(sum(${transactions.amountCents}), 0)`,
      transactionCount: sql<number>`count(${transactions.id})`,
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .groupBy(accounts.id)
    .orderBy(accounts.name);
}

export function sumNetWorth(rows: AccountWithBalance[]): number {
  return rows.reduce((sum, account) => sum + account.balanceCents, 0);
}

export async function getNetWorth(db: Db = getDb()): Promise<number> {
  return sumNetWorth(await getAccountsWithBalances(db));
}

export interface NetWorthOverview {
  netWorthCents: number;
  currencies: string[]; // distinct currency codes across accounts, sorted
}

// Net worth plus the currencies it spans. Summing balances is only meaningful
// within a single currency, so the dashboard warns when this spans more than
// one rather than presenting a meaningless mixed total (F8).
export async function getNetWorthOverview(db: Db = getDb()): Promise<NetWorthOverview> {
  const rows = await getAccountsWithBalances(db);
  const currencies = [...new Set(rows.map((r) => r.currency))].sort();
  return { netWorthCents: sumNetWorth(rows), currencies };
}

// Lightweight account list for dropdowns — avoids the per-account balance
// aggregate on pages that only need names (P3).
export interface AccountOption {
  id: string;
  name: string;
  type: string;
}

export async function getAccountOptions(db: Db = getDb()): Promise<AccountOption[]> {
  return db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type })
    .from(accounts)
    .orderBy(accounts.name);
}

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  institution?: string | null;
  openingBalanceCents?: number;
}

export async function createAccount(input: CreateAccountInput, db: Db = getDb()) {
  const [row] = await db
    .insert(accounts)
    .values({
      name: input.name,
      type: input.type,
      institution: input.institution ?? null,
      openingBalanceCents: input.openingBalanceCents ?? 0,
    })
    .returning();
  if (!row) throw new Error("failed to create account");
  return row;
}

export async function getAccountByName(name: string, db: Db = getDb()) {
  const [row] = await db.select().from(accounts).where(eq(accounts.name, name)).limit(1);
  return row ?? null;
}

export async function getOrCreateAccountByName(
  name: string,
  type: AccountType,
  db: Db = getDb(),
) {
  const existing = await getAccountByName(name, db);
  if (existing) return { account: existing, created: false as const };
  return { account: await createAccount({ name, type }, db), created: true as const };
}

export async function getAccountById(id: string, db: Db = getDb()) {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return row ?? null;
}

export interface UpdateAccountInput {
  name: string;
  type: AccountType;
  institution: string | null;
  openingBalanceCents: number;
}

export async function updateAccount(
  id: string,
  input: UpdateAccountInput,
  db: Db = getDb(),
): Promise<string | null> {
  const [row] = await db
    .update(accounts)
    .set(input)
    .where(eq(accounts.id, id))
    .returning({ id: accounts.id });
  return row?.id ?? null;
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
