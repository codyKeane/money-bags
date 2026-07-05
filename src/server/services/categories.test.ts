import { eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Db } from "@/db/client";
import { setupTestDb } from "@/test/test-db";
import { transactions } from "@/db/schema";
import {
  applyRulesToUncategorized,
  createCategory,
  deleteCategory,
  getCategoriesWithStats,
  updateCategory,
} from "./categories";
import { getOrCreateAccountByName } from "./accounts";

describe("categories service (integration, temp DB)", () => {
  const ctx = setupTestDb("finance-cat-");
  let db: Db;
  let accountId: string;
  let groceriesId: string;
  let diningId: string;

  beforeAll(async () => {
    db = ctx.db;
    const { account } = await getOrCreateAccountByName("Cat Test", "CHECKING", db);
    accountId = account.id;
    groceriesId = (
      await createCategory(
        { name: "Groceries", color: null, keywords: ["market"], excludeFromSpending: false },
        db,
      )
    ).id;
    diningId = (
      await createCategory(
        { name: "Dining", color: "#1baf7a", keywords: ["cafe"], excludeFromSpending: false },
        db,
      )
    ).id;
    await db.insert(transactions).values([
      // manually categorized to the "wrong" category on purpose
      {
        date: "2026-06-01",
        description: "CORNER MARKET",
        amountCents: -1000,
        accountId,
        categoryId: diningId,
      },
      // uncategorized, matches "market"
      {
        date: "2026-06-02",
        description: "FARMERS MARKET",
        amountCents: -2000,
        accountId,
        categoryId: null,
      },
      // uncategorized, matches nothing
      {
        date: "2026-06-03",
        description: "MYSTERY VENDOR",
        amountCents: -300,
        accountId,
        categoryId: null,
      },
    ]);
  });

  it("lists categories with transaction counts", async () => {
    const stats = await getCategoriesWithStats(db);
    expect(stats.map((s) => s.name)).toEqual(["Dining", "Groceries"]);
    expect(stats.find((s) => s.id === diningId)?.transactionCount).toBe(1);
    expect(stats.find((s) => s.id === groceriesId)?.transactionCount).toBe(0);
    expect(stats.find((s) => s.id === groceriesId)?.keywords).toEqual(["market"]);
  });

  it("applies rules to uncategorized rows only, preserving manual choices", async () => {
    const first = await applyRulesToUncategorized(db);
    expect(first).toEqual({ scanned: 2, updated: 1 });
    // manual (wrong) categorization untouched
    const [manual] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.description, "CORNER MARKET"));
    expect(manual?.categoryId).toBe(diningId);
    // matching row now categorized
    const [matched] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.description, "FARMERS MARKET"));
    expect(matched?.categoryId).toBe(groceriesId);
    // rerun scans only the remaining unmatched row
    expect(await applyRulesToUncategorized(db)).toEqual({ scanned: 1, updated: 0 });
  });

  it("updates keywords and excludeFromSpending", async () => {
    await updateCategory(
      groceriesId,
      { keywords: ["market", "grocer"], excludeFromSpending: true },
      db,
    );
    const stats = await getCategoriesWithStats(db);
    const groceries = stats.find((s) => s.id === groceriesId);
    expect(groceries?.keywords).toEqual(["market", "grocer"]);
    expect(groceries?.excludeFromSpending).toBe(true);
  });

  it("rejects duplicate names via the unique constraint", async () => {
    await expect(
      createCategory(
        { name: "Dining", color: null, keywords: [], excludeFromSpending: false },
        db,
      ),
    ).rejects.toThrow();
  });

  it("deleting a category nulls its transactions' categoryId", async () => {
    expect(await deleteCategory(groceriesId, db)).toBe(groceriesId);
    const orphans = await db
      .select()
      .from(transactions)
      .where(isNull(transactions.categoryId));
    expect(orphans.map((t) => t.description).sort()).toEqual([
      "FARMERS MARKET",
      "MYSTERY VENDOR",
    ]);
  });
});
