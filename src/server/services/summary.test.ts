import { beforeAll, describe, expect, it } from "vitest";
import { type Db } from "@/db/client";
import { setupTestDb } from "@/test/test-db";
import { transactions } from "@/db/schema";
import { getOrCreateAccountByName } from "./accounts";
import { createCategory } from "./categories";
import { getBudgetVsActual } from "./summary";

describe("getBudgetVsActual (integration, temp DB)", () => {
  const ctx = setupTestDb("finance-budget-");
  let db: Db;
  let noBudgetId: string;

  beforeAll(async () => {
    db = ctx.db;
    const { account } = await getOrCreateAccountByName("Budget Test", "CHECKING", db);
    const accountId = account.id;

    const groceriesId = (
      await createCategory(
        { name: "Groceries", color: null, keywords: [], excludeFromSpending: false, monthlyBudgetCents: 50000 },
        db,
      )
    ).id;
    const diningId = (
      await createCategory(
        { name: "Dining", color: null, keywords: [], excludeFromSpending: false, monthlyBudgetCents: 10000 },
        db,
      )
    ).id;
    // Budgeted but no spend this month — must still appear at 0 spent.
    await createCategory(
      { name: "Gifts", color: null, keywords: [], excludeFromSpending: false, monthlyBudgetCents: 20000 },
      db,
    );
    // No budget — must never appear, even though it has spend.
    noBudgetId = (
      await createCategory(
        { name: "Misc", color: null, keywords: [], excludeFromSpending: false },
        db,
      )
    ).id;

    await db.insert(transactions).values([
      { date: "2026-06-05", description: "MARKET", amountCents: -30000, accountId, categoryId: groceriesId },
      { date: "2026-06-10", description: "CAFE", amountCents: -15000, accountId, categoryId: diningId },
      // Refund in Dining must NOT reduce reported spend.
      { date: "2026-06-11", description: "REFUND", amountCents: 5000, accountId, categoryId: diningId },
      // Out-of-month grocery spend must be excluded.
      { date: "2026-05-31", description: "OLD", amountCents: -99999, accountId, categoryId: groceriesId },
      // No-budget category with spend must not surface.
      { date: "2026-06-12", description: "MISC", amountCents: -9999, accountId, categoryId: noBudgetId },
    ]);
  });

  it("returns only budgeted categories, sorted by name", async () => {
    const rows = await getBudgetVsActual("2026-06", db);
    expect(rows.map((r) => r.categoryName)).toEqual(["Dining", "Gifts", "Groceries"]);
  });

  it("computes spend, remaining, and the over-budget flag", async () => {
    const rows = await getBudgetVsActual("2026-06", db);
    const by = Object.fromEntries(rows.map((r) => [r.categoryName, r]));
    expect(by.Groceries).toMatchObject({
      budgetCents: 50000,
      spentCents: 30000, // out-of-month -99999 excluded
      remainingCents: 20000,
      overBudget: false,
    });
    expect(by.Dining).toMatchObject({
      budgetCents: 10000,
      spentCents: 15000, // +5000 refund does not reduce it
      remainingCents: -5000,
      overBudget: true,
    });
    expect(by.Gifts).toMatchObject({
      budgetCents: 20000,
      spentCents: 0,
      remainingCents: 20000,
      overBudget: false,
    });
  });
});
