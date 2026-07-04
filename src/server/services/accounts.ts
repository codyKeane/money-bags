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
