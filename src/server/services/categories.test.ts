import { eq, inArray, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db } from "@/db/client";
import { setupTestDbPerTest } from "@/test/test-db";
import { transactions, transactionSplits } from "@/db/schema";
import {
  applyRulesToUncategorized,
  createCategory,
  deleteCategory,
  getCategoriesWithStats,
  type CategoryInput,
  updateCategory,
} from "./categories";
import { getOrCreateAccountByName } from "./accounts";

async function mustCreateCategory(input: CategoryInput, db: Db) {
  const result = await createCategory(input, db);
  if (result.status !== "created") throw new Error(`category fixture failed: ${result.status}`);
  return result.category;
}

describe("categories service (integration, temp DB)", () => {
  const ctx = setupTestDbPerTest("finance-cat-");
  let db: Db;
  let accountId: string;
  let groceriesId: string;
  let diningId: string;

  beforeEach(async () => {
    db = ctx.db;
    const accountResult = await getOrCreateAccountByName("Cat Test", "CHECKING", "USD", db);
    if (accountResult.status === "invalid-input") throw new Error("account fixture failed");
    accountId = accountResult.account.id;
    groceriesId = (
      await mustCreateCategory(
        { name: "Groceries", color: null, keywords: ["market"], excludeFromSpending: false },
        db,
      )
    ).id;
    diningId = (
      await mustCreateCategory(
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
    expect(first).toEqual({ status: "updated", scanned: 2, updated: 1 });
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
    expect(await applyRulesToUncategorized(db)).toEqual({
      status: "updated",
      scanned: 1,
      updated: 0,
    });
  });

  it("skips split parents during rule application, including historical mismatches", async () => {
    await db.insert(transactions).values([
      {
        id: "broken-market",
        date: "2026-06-04",
        description: "BROKEN MARKET",
        amountCents: -2000,
        accountId,
        categoryId: null,
      },
      {
        id: "valid-market",
        date: "2026-06-05",
        description: "VALID MARKET",
        amountCents: -1000,
        accountId,
        categoryId: null,
      },
    ]);
    await db.insert(transactionSplits).values([
      { transactionId: "broken-market", categoryId: groceriesId, amountCents: -1000 },
      { transactionId: "broken-market", categoryId: diningId, amountCents: -500 },
    ]);

    await expect(applyRulesToUncategorized(db)).resolves.toEqual({
      status: "updated",
      scanned: 3,
      updated: 2,
    });
    const rows = await db
      .select({ id: transactions.id, categoryId: transactions.categoryId })
      .from(transactions)
      .where(inArray(transactions.id, ["broken-market", "valid-market"]));
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: "broken-market", categoryId: null },
        { id: "valid-market", categoryId: groceriesId },
      ]),
    );
  });

  it("updates keywords and excludeFromSpending", async () => {
    expect(await updateCategory(
      groceriesId,
      { keywords: ["market", "grocer"], excludeFromSpending: true },
      db,
    )).toEqual({ status: "updated", id: groceriesId });
    const stats = await getCategoriesWithStats(db);
    const groceries = stats.find((s) => s.id === groceriesId);
    expect(groceries?.keywords).toEqual(["market", "grocer"]);
    expect(groceries?.excludeFromSpending).toBe(true);
  });

  it("returns a typed duplicate-name outcome without a raw constraint error", async () => {
    await expect(
      createCategory(
        { name: " Dining ", color: null, keywords: [], excludeFromSpending: false },
        db,
      ),
    ).resolves.toEqual({ status: "duplicate-name" });
    await expect(updateCategory(groceriesId, { name: "Dining" }, db)).resolves.toEqual({
      status: "duplicate-name",
    });
  });

  it("rejects invalid names, colors, keywords, and budgets without writing", async () => {
    const before = await getCategoriesWithStats(db);
    const base: Omit<CategoryInput, "name"> = {
      color: null,
      keywords: [],
      excludeFromSpending: false,
    };

    await expect(createCategory({ ...base, name: "  " }, db)).resolves.toMatchObject({
      status: "invalid-input",
      field: "name",
    });
    await expect(
      createCategory({ ...base, name: "No budget", monthlyBudgetCents: 0 }, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "monthlyBudgetCents" });
    await expect(
      createCategory(
        { ...base, name: "Unsafe budget", monthlyBudgetCents: Number.MAX_SAFE_INTEGER + 1 },
        db,
      ),
    ).resolves.toMatchObject({ status: "invalid-input", field: "monthlyBudgetCents" });
    await expect(
      createCategory({ ...base, name: "Bad color", color: "#ffffff" }, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "color" });
    await expect(
      createCategory({ ...base, name: "Bad keyword", keywords: ["x".repeat(121)] }, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "keywords" });

    expect(await getCategoriesWithStats(db)).toEqual(before);
  });

  it("returns not-found and preserves the row after an invalid update", async () => {
    await expect(updateCategory("missing-category", { name: "Missing" }, db)).resolves.toEqual({
      status: "not-found",
    });
    const before = await getCategoriesWithStats(db);
    await expect(
      updateCategory(groceriesId, { monthlyBudgetCents: -1 }, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "monthlyBudgetCents" });
    expect(await getCategoriesWithStats(db)).toEqual(before);
  });

  it("deleting a category nulls its transactions' categoryId", async () => {
    await db
      .update(transactions)
      .set({ categoryId: groceriesId })
      .where(eq(transactions.description, "FARMERS MARKET"));
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
