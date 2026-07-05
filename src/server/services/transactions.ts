import { and, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { accounts, categories, transactions } from "@/db/schema";
import { monthRange } from "@/lib/month";

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

// Single source of the list projection + joins, shared by the paged query and
// getRecentTransactions (Q5).
const transactionListColumns = {
  id: transactions.id,
  date: transactions.date,
  description: transactions.description,
  amountCents: transactions.amountCents,
  accountName: accounts.name,
  currency: accounts.currency,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
  categoryColor: categories.color,
} as const;

export async function getRecentTransactions(
  limit = 10,
  db: Db = getDb(),
): Promise<TransactionListItem[]> {
  const { items } = await getTransactionsPage({ limit, offset: 0 }, db);
  return items;
}

export interface TransactionFilter {
  q?: string; // description substring, case-insensitive
  accountId?: string;
  categoryId?: string | null; // null = uncategorized, undefined = any
  month?: string; // YYYY-MM
  limit: number;
  offset: number;
}

export interface TransactionPage {
  items: TransactionListItem[];
  totalCount: number;
}

function buildTransactionWhere(filter: TransactionFilter): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.q) {
    // escape LIKE wildcards so the user searches literal text
    const escaped = filter.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    conditions.push(
      sql`${transactions.description} LIKE ${"%" + escaped + "%"} ESCAPE '\\'`,
    );
  }
  if (filter.accountId) conditions.push(eq(transactions.accountId, filter.accountId));
  if (filter.categoryId === null) conditions.push(isNull(transactions.categoryId));
  else if (filter.categoryId) conditions.push(eq(transactions.categoryId, filter.categoryId));
  if (filter.month) {
    // range predicate hits transactions_date_idx (P1)
    const { start, endExclusive } = monthRange(filter.month);
    conditions.push(gte(transactions.date, start), lt(transactions.date, endExclusive));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function getTransactionsPage(
  filter: TransactionFilter,
  db: Db = getDb(),
): Promise<TransactionPage> {
  const where = buildTransactionWhere(filter);
  const [countRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .where(where);
  const items = await db
    .select(transactionListColumns)
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(filter.limit)
    .offset(filter.offset);
  return { items, totalCount: countRow?.n ?? 0 };
}

export async function getLatestTransactionMonth(db: Db = getDb()): Promise<string | null> {
  // substr(max(date),1,7) uses the min/max index optimization; max(substr(...))
  // would scan (P1).
  const [row] = await db
    .select({ month: sql<string | null>`substr(max(${transactions.date}), 1, 7)` })
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

// ---------- manual transaction CRUD (importHash stays null) ----------

export interface TransactionInput {
  accountId: string;
  categoryId: string | null;
  date: string; // YYYY-MM-DD
  description: string;
  amountCents: number; // signed: negative = outflow
}

export async function createTransaction(input: TransactionInput, db: Db = getDb()) {
  const [row] = await db.insert(transactions).values(input).returning();
  if (!row) throw new Error("failed to create transaction");
  return row;
}

export async function updateTransaction(
  id: string,
  input: TransactionInput,
  db: Db = getDb(),
): Promise<string | null> {
  const [row] = await db
    .update(transactions)
    .set(input)
    .where(eq(transactions.id, id))
    .returning({ id: transactions.id });
  return row?.id ?? null;
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
  return row ?? null;
}
