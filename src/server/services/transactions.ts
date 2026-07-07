import { and, desc, eq, gte, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  accounts,
  categories,
  transactions,
  transactionSplits,
  type TransactionSplit,
} from "@/db/schema";
import { isValidIsoDate, isValidMonth, monthRange } from "@/lib/month";

export interface TransactionListItem {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  accountId: string;
  accountName: string;
  currency: string;
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
  amountCents: transactions.amountCents,
  accountId: transactions.accountId,
  accountName: accounts.name,
  currency: accounts.currency,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
  categoryColor: categories.color,
  isSplit: sql<number>`(exists (select 1 from ${transactionSplits} where ${transactionSplits.transactionId} = ${transactions.id}))`,
} as const;

export async function getRecentTransactions(
  limit = 10,
  db: Db = getDb(),
): Promise<TransactionListItem[]> {
  const { items } = await getTransactionsPage({ limit, offset: 0 }, db);
  return items;
}

// The filterable predicate set, shared by the paged list and the CSV export.
export interface TransactionQuery {
  q?: string; // description substring, case-insensitive
  accountId?: string;
  categoryId?: string | null; // null = uncategorized, undefined = any
  month?: string; // YYYY-MM
  from?: string; // YYYY-MM-DD inclusive lower bound (F7)
  to?: string; // YYYY-MM-DD inclusive upper bound (F7)
}

export interface TransactionFilter extends TransactionQuery {
  limit: number;
  offset: number;
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
  return {
    q: get("q")?.trim() || undefined,
    accountId: get("account") || undefined,
    categoryId: rawCategory === "uncategorized" ? null : rawCategory,
    month: rawMonth && isValidMonth(rawMonth) ? rawMonth : undefined,
    from: validDate(get("from")),
    to: validDate(get("to")),
  };
}

export interface TransactionPage {
  items: TransactionListItem[];
  totalCount: number;
}

function buildTransactionWhere(filter: TransactionQuery): SQL | undefined {
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
  // Date-only bounds; both inclusive since dates carry no time component. These
  // AND with `month` if a caller passes both — an intentional intersection.
  if (filter.from) conditions.push(gte(transactions.date, filter.from));
  if (filter.to) conditions.push(lte(transactions.date, filter.to));
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
  const rows = await db
    .select(transactionListColumns)
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(filter.limit)
    .offset(filter.offset);
  const items = rows.map((r) => ({ ...r, isSplit: r.isSplit > 0 }));
  return { items, totalCount: countRow?.n ?? 0 };
}

// All rows matching a filter, unpaged, for CSV export (F2). Oldest first so the
// exported file reads like a statement. Shares buildTransactionWhere/projection
// with the paged list so filters behave identically.
export async function getTransactionsForExport(
  query: TransactionQuery,
  db: Db = getDb(),
): Promise<TransactionListItem[]> {
  const rows = await db
    .select(transactionListColumns)
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(buildTransactionWhere(query))
    .orderBy(transactions.date, transactions.createdAt);
  return rows.map((r) => ({ ...r, isSplit: r.isSplit > 0 }));
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

// ---------- transaction splits ----------

export interface SplitInput {
  categoryId: string | null;
  amountCents: number; // signed; same convention as transactions
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

// Replace every split for a transaction in one DB transaction. Empty `parts`
// clears the split, reverting the transaction to its own categoryId. The caller
// is responsible for validating that the parts sum to the transaction amount.
export async function replaceSplits(
  transactionId: string,
  parts: SplitInput[],
  db: Db = getDb(),
): Promise<void> {
  db.transaction((tx) => {
    tx.delete(transactionSplits)
      .where(eq(transactionSplits.transactionId, transactionId))
      .run();
    if (parts.length > 0) {
      tx.insert(transactionSplits)
        .values(
          parts.map((p) => ({
            transactionId,
            categoryId: p.categoryId,
            amountCents: p.amountCents,
          })),
        )
        .run();
    }
  });
}
