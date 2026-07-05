import { eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { categories, transactions, type Category } from "@/db/schema";
import { categorize, parseKeywords } from "@/lib/categorize";

export interface CategoryWithStats {
  id: string;
  name: string;
  color: string | null;
  keywords: string[];
  excludeFromSpending: boolean;
  transactionCount: number;
}

export async function getCategoriesWithStats(db: Db = getDb()): Promise<CategoryWithStats[]> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      keywords: categories.keywords,
      excludeFromSpending: categories.excludeFromSpending,
      transactionCount: sql<number>`count(${transactions.id})`,
    })
    .from(categories)
    .leftJoin(transactions, eq(transactions.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(categories.name);
  return rows.map((r) => ({ ...r, keywords: parseKeywords(r.keywords) }));
}

export interface CategoryInput {
  name: string;
  color: string | null;
  keywords: string[];
  excludeFromSpending: boolean;
}

export async function createCategory(input: CategoryInput, db: Db = getDb()): Promise<Category> {
  const [row] = await db
    .insert(categories)
    .values({
      name: input.name,
      color: input.color,
      keywords: JSON.stringify(input.keywords),
      excludeFromSpending: input.excludeFromSpending,
    })
    .returning();
  if (!row) throw new Error("failed to create category");
  return row;
}

export async function updateCategory(
  id: string,
  patch: Partial<CategoryInput>,
  db: Db = getDb(),
): Promise<string | null> {
  const [row] = await db
    .update(categories)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.keywords !== undefined ? { keywords: JSON.stringify(patch.keywords) } : {}),
      ...(patch.excludeFromSpending !== undefined
        ? { excludeFromSpending: patch.excludeFromSpending }
        : {}),
    })
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  return row?.id ?? null;
}

// Transactions keep their rows: the FK is ON DELETE SET NULL, so they simply
// become uncategorized.
export async function deleteCategory(id: string, db: Db = getDb()): Promise<string | null> {
  const [row] = await db
    .delete(categories)
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  return row?.id ?? null;
}

export async function getCategoryByName(name: string, db: Db = getDb()): Promise<Category | null> {
  const [row] = await db.select().from(categories).where(eq(categories.name, name)).limit(1);
  return row ?? null;
}

export async function getCategoryById(id: string, db: Db = getDb()): Promise<Category | null> {
  const [row] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  return row ?? null;
}

export async function getAllCategories(db: Db = getDb()) {
  return db.select().from(categories).orderBy(categories.name);
}

// SQLite's default variable limit is 999; keep IN-lists well under it.
const UPDATE_CHUNK = 500;

// Re-runs the keyword matcher over uncategorized rows ONLY — manual
// categorizations are never touched. Matches are grouped by resolved category
// and written with one `UPDATE … WHERE id IN (…)` per category rather than a
// re-prepared UPDATE per row (P5). Returns how many were scanned/updated.
export async function applyRulesToUncategorized(
  db: Db = getDb(),
): Promise<{ scanned: number; updated: number }> {
  const categoryRows = await db.select().from(categories);
  const matchers = categoryRows.map((c) => ({
    id: c.id,
    name: c.name,
    keywords: parseKeywords(c.keywords),
  }));
  const rows = await db
    .select({ id: transactions.id, description: transactions.description })
    .from(transactions)
    .where(isNull(transactions.categoryId));

  const idsByCategory = new Map<string, string[]>();
  for (const row of rows) {
    const categoryId = categorize(row.description, matchers);
    if (!categoryId) continue;
    const list = idsByCategory.get(categoryId);
    if (list) list.push(row.id);
    else idsByCategory.set(categoryId, [row.id]);
  }

  let updated = 0;
  db.transaction((tx) => {
    for (const [categoryId, ids] of idsByCategory) {
      for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
        const chunk = ids.slice(i, i + UPDATE_CHUNK);
        const result = tx
          .update(transactions)
          .set({ categoryId })
          .where(inArray(transactions.id, chunk))
          .run();
        updated += result.changes;
      }
    }
  });
  return { scanned: rows.length, updated };
}
