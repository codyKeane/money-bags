import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import { getDb, type Db } from "@/db/client";
import { categories, transactions, transactionSplits, type Category } from "@/db/schema";
import { categorize, parseKeywords } from "@/lib/categorize";
import { transactionHasNoSplits, transactionHasSplits } from "./active-category";
import {
  invalidWriteInput,
  isBoolean,
  isValidBudgetCents,
  normalizeCategoryColor,
  normalizeCategoryName,
  normalizeId,
  normalizeKeywords,
  type InvalidWriteInput,
} from "./write-validation";

export interface CategoryWithStats {
  id: string;
  name: string;
  color: string | null;
  keywords: string[];
  excludeFromSpending: boolean;
  monthlyBudgetCents: number | null;
  transactionCount: number;
  deletionImpact: CategoryDeletionImpact;
}

export interface CategoryDeletionImpact {
  categoryId: string;
  // Distinct parents using this category under active split semantics.
  activeTransactionCount: number;
  // Exact split rows whose category FK becomes null on deletion.
  activeSplitPartCount: number;
  // Split parents whose ignored fallback FK is also cleared. This can overlap
  // activeTransactionCount when a parent fallback and one of its parts match.
  ignoredParentTransactionCount: number;
}

function activeCategoryUsage(db: Db) {
  const unsplit = db
    .select({
      transactionId: transactions.id,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(transactionHasNoSplits());
  const split = db
    .select({
      transactionId: transactionSplits.transactionId,
      categoryId: transactionSplits.categoryId,
    })
    .from(transactionSplits)
    .groupBy(transactionSplits.transactionId, transactionSplits.categoryId);
  return unionAll(unsplit, split).as("active_category_usage");
}

export async function getCategoriesWithStats(db: Db = getDb()): Promise<CategoryWithStats[]> {
  const activeUsage = activeCategoryUsage(db);
  const activeSplitParts = db
    .select({
      categoryId: transactionSplits.categoryId,
      partCount: count().as("active_split_part_count"),
    })
    .from(transactionSplits)
    .where(isNotNull(transactionSplits.categoryId))
    .groupBy(transactionSplits.categoryId)
    .as("active_split_parts");
  const ignoredParents = db
    .select({
      categoryId: transactions.categoryId,
      transactionCount: count().as("ignored_parent_transaction_count"),
    })
    .from(transactions)
    .where(and(isNotNull(transactions.categoryId), transactionHasSplits()))
    .groupBy(transactions.categoryId)
    .as("ignored_category_parents");
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      color: categories.color,
      keywords: categories.keywords,
      excludeFromSpending: categories.excludeFromSpending,
      monthlyBudgetCents: categories.monthlyBudgetCents,
      activeTransactionCount: sql<number>`count(${activeUsage.transactionId})`,
      activeSplitPartCount: sql<number>`coalesce(${activeSplitParts.partCount}, 0)`,
      ignoredParentTransactionCount: sql<number>`coalesce(${ignoredParents.transactionCount}, 0)`,
    })
    .from(categories)
    .leftJoin(activeUsage, eq(activeUsage.categoryId, categories.id))
    .leftJoin(activeSplitParts, eq(activeSplitParts.categoryId, categories.id))
    .leftJoin(ignoredParents, eq(ignoredParents.categoryId, categories.id))
    .groupBy(
      categories.id,
      sql`${activeSplitParts.partCount}`,
      sql`${ignoredParents.transactionCount}`,
    )
    .orderBy(categories.name);
  return rows.map(
    ({ activeTransactionCount, activeSplitPartCount, ignoredParentTransactionCount, ...row }) => ({
      ...row,
      keywords: parseKeywords(row.keywords),
      transactionCount: activeTransactionCount,
      deletionImpact: {
        categoryId: row.id,
        activeTransactionCount,
        activeSplitPartCount,
        ignoredParentTransactionCount,
      },
    }),
  );
}

export interface CategoryInput {
  name: string;
  color: string | null;
  keywords: string[];
  excludeFromSpending: boolean;
  monthlyBudgetCents?: number | null; // omitted = no budget
}

interface NormalizedCategoryInput {
  name: string;
  color: string | null;
  keywords: string[];
  excludeFromSpending: boolean;
  monthlyBudgetCents: number | null;
}

export type CreateCategoryResult =
  | { status: "created"; category: Category }
  | { status: "duplicate-name" }
  | InvalidWriteInput;

function normalizeCategoryInput(
  input: CategoryInput,
): { ok: true; value: NormalizedCategoryInput } | { ok: false; result: InvalidWriteInput } {
  const name = normalizeCategoryName(input.name);
  if (!name) {
    return { ok: false, result: invalidWriteInput("name", "Category name is required") };
  }
  const color = normalizeCategoryColor(input.color);
  if (color === undefined) {
    return { ok: false, result: invalidWriteInput("color", "Unknown category color") };
  }
  const keywords = normalizeKeywords(input.keywords);
  if (!keywords) {
    return { ok: false, result: invalidWriteInput("keywords", "Invalid category keywords") };
  }
  if (!isBoolean(input.excludeFromSpending)) {
    return {
      ok: false,
      result: invalidWriteInput("excludeFromSpending", "Invalid spending exclusion"),
    };
  }
  const monthlyBudgetCents = input.monthlyBudgetCents ?? null;
  if (!isValidBudgetCents(monthlyBudgetCents)) {
    return {
      ok: false,
      result: invalidWriteInput("monthlyBudgetCents", "Budget must be positive exact cents"),
    };
  }
  return {
    ok: true,
    value: {
      name,
      color,
      keywords,
      excludeFromSpending: input.excludeFromSpending,
      monthlyBudgetCents,
    },
  };
}

export async function createCategory(
  input: CategoryInput,
  db: Db = getDb(),
): Promise<CreateCategoryResult> {
  const normalized = normalizeCategoryInput(input);
  if (!normalized.ok) return normalized.result;

  const row = await db
    .insert(categories)
    .values({
      ...normalized.value,
      keywords: JSON.stringify(normalized.value.keywords),
    })
    .onConflictDoNothing({ target: categories.name })
    .returning()
    .get();
  return row ? { status: "created", category: row } : { status: "duplicate-name" };
}

type NormalizedCategoryPatch = Partial<NormalizedCategoryInput>;

function normalizeCategoryPatch(
  patch: Partial<CategoryInput>,
): { ok: true; value: NormalizedCategoryPatch } | { ok: false; result: InvalidWriteInput } {
  const value: NormalizedCategoryPatch = {};
  if (patch.name !== undefined) {
    const name = normalizeCategoryName(patch.name);
    if (!name) {
      return { ok: false, result: invalidWriteInput("name", "Category name is required") };
    }
    value.name = name;
  }
  if (patch.color !== undefined) {
    const color = normalizeCategoryColor(patch.color);
    if (color === undefined) {
      return { ok: false, result: invalidWriteInput("color", "Unknown category color") };
    }
    value.color = color;
  }
  if (patch.keywords !== undefined) {
    const keywords = normalizeKeywords(patch.keywords);
    if (!keywords) {
      return { ok: false, result: invalidWriteInput("keywords", "Invalid category keywords") };
    }
    value.keywords = keywords;
  }
  if (patch.excludeFromSpending !== undefined) {
    if (!isBoolean(patch.excludeFromSpending)) {
      return {
        ok: false,
        result: invalidWriteInput("excludeFromSpending", "Invalid spending exclusion"),
      };
    }
    value.excludeFromSpending = patch.excludeFromSpending;
  }
  if (patch.monthlyBudgetCents !== undefined) {
    if (!isValidBudgetCents(patch.monthlyBudgetCents)) {
      return {
        ok: false,
        result: invalidWriteInput("monthlyBudgetCents", "Budget must be positive exact cents"),
      };
    }
    value.monthlyBudgetCents = patch.monthlyBudgetCents;
  }
  return { ok: true, value };
}

export type UpdateCategoryResult =
  | { status: "updated"; id: string }
  | { status: "not-found" }
  | { status: "duplicate-name" }
  | InvalidWriteInput;

export async function updateCategory(
  id: string,
  patch: Partial<CategoryInput>,
  db: Db = getDb(),
): Promise<UpdateCategoryResult> {
  const normalizedId = normalizeId(id);
  if (!normalizedId) return invalidWriteInput("id", "Invalid category id");
  const normalized = normalizeCategoryPatch(patch);
  if (!normalized.ok) return normalized.result;

  return db.transaction(
    (tx) => {
      const current = tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, normalizedId))
        .limit(1)
        .get();
      if (!current) return { status: "not-found" as const };

      if (normalized.value.name !== undefined) {
        const nameOwner = tx
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.name, normalized.value.name))
          .limit(1)
          .get();
        if (nameOwner && nameOwner.id !== normalizedId) {
          return { status: "duplicate-name" as const };
        }
      }

      const { keywords, ...otherValues } = normalized.value;
      const values = {
        ...otherValues,
        ...(keywords !== undefined ? { keywords: JSON.stringify(keywords) } : {}),
      };
      if (Object.keys(values).length === 0) {
        return { status: "updated" as const, id: normalizedId };
      }
      const row = tx
        .update(categories)
        .set(values)
        .where(eq(categories.id, normalizedId))
        .returning({ id: categories.id })
        .get();
      if (!row) throw new Error("category disappeared during update");
      return { status: "updated" as const, id: row.id };
    },
    { behavior: "immediate" },
  );
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

export type MergeCategoryResult =
  | { status: "merged"; sourceId: string; targetId: string; transactionCount: number; splitPartCount: number }
  | { status: "not-found" }
  | { status: "same-category" }
  | InvalidWriteInput;

export async function mergeCategory(
  sourceId: string,
  targetId: string,
  db: Db = getDb(),
): Promise<MergeCategoryResult> {
  const source = normalizeId(sourceId);
  const target = normalizeId(targetId);
  if (!source || !target) return invalidWriteInput("categoryId", "Invalid category id");
  if (source === target) return { status: "same-category" };
  return db.transaction(
    (tx) => {
      const categoriesFound = tx
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.id, [source, target]))
        .all();
      if (categoriesFound.length !== 2) return { status: "not-found" as const };
      const transactionResult = tx
        .update(transactions)
        .set({ categoryId: target })
        .where(eq(transactions.categoryId, source))
        .run();
      const splitResult = tx
        .update(transactionSplits)
        .set({ categoryId: target })
        .where(eq(transactionSplits.categoryId, source))
        .run();
      const deleted = tx.delete(categories).where(eq(categories.id, source)).run();
      if (deleted.changes !== 1) throw new Error("Source category disappeared during merge");
      return {
        status: "merged" as const,
        sourceId: source,
        targetId: target,
        transactionCount: transactionResult.changes,
        splitPartCount: splitResult.changes,
      };
    },
    { behavior: "immediate" },
  );
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
): Promise<{ status: "updated"; scanned: number; updated: number }> {
  return db.transaction(
    (tx) => {
      const categoryRows = tx.select().from(categories).all();
      const matchers = categoryRows.map((c) => ({
        id: c.id,
        name: c.name,
        keywords: parseKeywords(c.keywords),
      }));
      const rows = tx
        .select({ id: transactions.id, description: transactions.description })
        .from(transactions)
        .where(and(isNull(transactions.categoryId), transactionHasNoSplits()))
        .all();

      const idsByCategory = new Map<string, string[]>();
      for (const row of rows) {
        const categoryId = categorize(row.description, matchers);
        if (!categoryId) continue;
        const list = idsByCategory.get(categoryId);
        if (list) list.push(row.id);
        else idsByCategory.set(categoryId, [row.id]);
      }

      let updated = 0;
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
      return { status: "updated" as const, scanned: rows.length, updated };
    },
    { behavior: "immediate" },
  );
}
