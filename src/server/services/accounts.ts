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

export async function getNetWorth(db: Db = getDb()): Promise<number> {
  const rows = await getAccountsWithBalances(db);
  return rows.reduce((sum, account) => sum + account.balanceCents, 0);
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
