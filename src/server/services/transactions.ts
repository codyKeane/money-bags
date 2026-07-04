import { desc, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { accounts, categories, transactions } from "@/db/schema";

export interface TransactionListItem {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  accountName: string;
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
}

export async function getRecentTransactions(
  limit = 10,
  db: Db = getDb(),
): Promise<TransactionListItem[]> {
  return db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amountCents: transactions.amountCents,
      accountName: accounts.name,
      currency: accounts.currency,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(limit);
}

export async function getLatestTransactionMonth(db: Db = getDb()): Promise<string | null> {
  const [row] = await db
    .select({ month: sql<string | null>`max(substr(${transactions.date}, 1, 7))` })
    .from(transactions);
  return row?.month ?? null;
}

// Returns the updated row id, or null if the transaction doesn't exist.
export async function setTransactionCategory(
  transactionId: string,
  categoryId: string | null,
  db: Db = getDb(),
): Promise<string | null> {
  const [row] = await db
    .update(transactions)
    .set({ categoryId })
    .where(eq(transactions.id, transactionId))
    .returning({ id: transactions.id });
  return row?.id ?? null;
}

export async function getAllCategories(db: Db = getDb()) {
  return db.select().from(categories).orderBy(categories.name);
}
