import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Db } from "@/db/client";
import { setupTestDb, setupTestDbPerTest } from "@/test/test-db";
import { accounts, transactions, transactionSplits } from "@/db/schema";
import { getNetWorthOverview, getOrCreateAccountByName } from "./accounts";
import { createCategory, updateCategory, type CategoryInput } from "./categories";
import {
  getBudgetVsActual,
  getDashboardAggregateOverview,
  getMonthlySpendingByCategory,
  getMonthlySpendingOverview,
  getMonthlySummary,
  getSpendingTrend,
} from "./summary";

describe("currency-aware combined spending DTOs", () => {
  const ctx = setupTestDbPerTest("finance-currency-summary-");

  it("suppresses every combined scalar and collection for mixed accounts even if only one has activity", async () => {
    const [usd, eur] = await ctx.db
      .insert(accounts)
      .values([
        { name: "Dollars", type: "CHECKING", currency: "USD" },
        { name: "Euros", type: "SAVINGS", currency: "EUR" },
      ])
      .returning({ id: accounts.id });
    if (!usd || !eur) throw new Error("account fixture failed");
    await ctx.db.insert(transactions).values({
      date: "2026-06-01",
      description: "USD ONLY",
      amountCents: -100,
      accountId: usd.id,
    });

    const netWorth = await getNetWorthOverview(ctx.db);
    await expect(getMonthlySpendingOverview("2026-06", netWorth, ctx.db)).resolves.toEqual({
      currencyState: { kind: "mixed", currencies: ["EUR", "USD"] },
      aggregateState: { kind: "unavailable" },
      summary: { incomeCents: null, spendingCents: null },
      byCategory: [],
    });
    await expect(
      getDashboardAggregateOverview("2026-06", "2026-06", netWorth, ctx.db),
    ).resolves.toMatchObject({
      aggregateState: { kind: "unavailable" },
      summary: { incomeCents: null, spendingCents: null },
      byCategory: [],
      budgets: [],
      trend: [],
    });
  });

  it("returns numeric combined values with the normalized single currency", async () => {
    const [account] = await ctx.db
      .insert(accounts)
      .values({ name: "Euro", type: "CHECKING", currency: " eur " })
      .returning({ id: accounts.id });
    if (!account) throw new Error("account fixture failed");
    await ctx.db.insert(transactions).values({
      date: "2026-06-01",
      description: "EURO SPEND",
      amountCents: -250,
      accountId: account.id,
    });

    const result = await getMonthlySpendingOverview(
      "2026-06",
      await getNetWorthOverview(ctx.db),
      ctx.db,
    );
    expect(result).toMatchObject({
      currencyState: { kind: "single", currency: "EUR" },
      aggregateState: { kind: "ready" },
      summary: { incomeCents: 0, spendingCents: 250 },
    });
  });

  it("returns an explicit unsafe state when a persisted combined sum is not exact-safe", async () => {
    const [account] = await ctx.db
      .insert(accounts)
      .values({ name: "Unsafe", type: "CHECKING", currency: "USD" })
      .returning({ id: accounts.id });
    if (!account) throw new Error("account fixture failed");
    await ctx.db.insert(transactions).values({
      date: "2026-06-01",
      description: "UNSAFE STORED VALUE",
      amountCents: Number.MIN_SAFE_INTEGER - 1,
      accountId: account.id,
    });

    const netWorth = {
      currencyState: { kind: "single", currency: "USD" },
      aggregateState: { kind: "ready" },
      netWorthCents: 0,
    } as const;
    await expect(getMonthlySpendingOverview("2026-06", netWorth, ctx.db)).resolves.toEqual({
      currencyState: { kind: "single", currency: "USD" },
      aggregateState: { kind: "unsafe" },
      summary: { incomeCents: null, spendingCents: null },
      byCategory: [],
    });
  });
});

async function mustGetOrCreateAccount(name: string, db: Db) {
  const result = await getOrCreateAccountByName(name, "CHECKING", "USD", db);
  if (result.status === "invalid-input") throw new Error("account fixture failed");
  return result.account;
}

async function mustCreateCategory(input: CategoryInput, db: Db) {
  const result = await createCategory(input, db);
  if (result.status !== "created") throw new Error(`category fixture failed: ${result.status}`);
  return result.category;
}

// These three suites intentionally share one temp DB each: setup completes in
// beforeAll, and every test treats the resulting rows as an immutable fixture.
describe("getBudgetVsActual (integration, temp DB)", () => {
  const ctx = setupTestDb("finance-budget-");
  let db: Db;
  let noBudgetId: string;

  beforeAll(async () => {
    db = ctx.db;
    const account = await mustGetOrCreateAccount("Budget Test", db);
    const accountId = account.id;

    const groceriesId = (
      await mustCreateCategory(
        { name: "Groceries", color: null, keywords: [], excludeFromSpending: false, monthlyBudgetCents: 50000 },
        db,
      )
    ).id;
    const diningId = (
      await mustCreateCategory(
        { name: "Dining", color: null, keywords: [], excludeFromSpending: false, monthlyBudgetCents: 10000 },
        db,
      )
    ).id;
    // Budgeted but no spend this month — must still appear at 0 spent.
    await mustCreateCategory(
      { name: "Gifts", color: null, keywords: [], excludeFromSpending: false, monthlyBudgetCents: 20000 },
      db,
    );
    // No budget — must never appear, even though it has spend.
    noBudgetId = (
      await mustCreateCategory(
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

describe("getSpendingTrend (integration, temp DB)", () => {
  const ctx = setupTestDb("finance-trend-");

  beforeAll(async () => {
    const db = ctx.db;
    const account = await mustGetOrCreateAccount("Trend Test", db);
    const accountId = account.id;
    const transfersId = (
      await mustCreateCategory(
        { name: "Transfers", color: null, keywords: [], excludeFromSpending: true },
        db,
      )
    ).id;
    await db.insert(transactions).values([
      // March: income + spending.
      { date: "2026-03-10", description: "PAY", amountCents: 500000, accountId, categoryId: null },
      { date: "2026-03-15", description: "RENT", amountCents: -150000, accountId, categoryId: null },
      // April: only a transfer — excluded, so April stays zero.
      { date: "2026-04-01", description: "MOVE", amountCents: -100000, accountId, categoryId: transfersId },
      // May: spending only.
      { date: "2026-05-02", description: "GROCERY", amountCents: -8000, accountId, categoryId: null },
    ]);
  });

  it("zero-fills quiet months and keeps the window in order", async () => {
    const points = await getSpendingTrend("2026-05", 3, ctx.db); // Mar, Apr, May
    expect(points.map((p) => p.month)).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(points[0]).toMatchObject({ incomeCents: 500000, spendingCents: 150000 });
    // April's only row is an excluded transfer → both zero.
    expect(points[1]).toMatchObject({ incomeCents: 0, spendingCents: 0 });
    expect(points[2]).toMatchObject({ incomeCents: 0, spendingCents: 8000 });
  });

  it("returns exactly `months` points even with no data before the window", async () => {
    const points = await getSpendingTrend("2026-05", 6, ctx.db);
    expect(points).toHaveLength(6);
    expect(points[0]).toMatchObject({ month: "2025-12", incomeCents: 0, spendingCents: 0 });
  });
});

describe("split-aware spending aggregates (integration, temp DB)", () => {
  const ctx = setupTestDb("finance-splitagg-");
  let db: Db;

  beforeAll(async () => {
    db = ctx.db;
    const account = await mustGetOrCreateAccount("Split Agg", db);
    const accountId = account.id;
    const groceries = (
      await mustCreateCategory(
        { name: "Groceries", color: null, keywords: [], excludeFromSpending: false, monthlyBudgetCents: 50000 },
        db,
      )
    ).id;
    const household = (
      await mustCreateCategory({ name: "Household", color: null, keywords: [], excludeFromSpending: false }, db)
    ).id;
    const gift = (
      await mustCreateCategory({ name: "Gift", color: null, keywords: [], excludeFromSpending: true }, db)
    ).id;

    // A -100.00 store run split three ways: 60 groceries + 30 household + 10
    // gift (excluded). Its own categoryId is null and must be ignored.
    await db
      .insert(transactions)
      .values({ id: "split-run", date: "2026-06-10", description: "TARGET RUN", amountCents: -10000, accountId, categoryId: null });
    await db.insert(transactionSplits).values([
      { transactionId: "split-run", categoryId: groceries, amountCents: -6000 },
      { transactionId: "split-run", categoryId: household, amountCents: -3000 },
      { transactionId: "split-run", categoryId: gift, amountCents: -1000 },
    ]);
    // A whole grocery buy (unsplit) and an income row.
    await db.insert(transactions).values([
      { date: "2026-06-11", description: "MARKET", amountCents: -2000, accountId, categoryId: groceries },
      { date: "2026-06-01", description: "PAY", amountCents: 200000, accountId, categoryId: null },
    ]);
  });

  it("spending-by-category counts each split part in its own category; excluded parts drop", async () => {
    const spend = await getMonthlySpendingByCategory("2026-06", db);
    const by = Object.fromEntries(spend.map((s) => [s.categoryName, s.spentCents]));
    expect(by.Groceries).toBe(8000); // 6000 split part + 2000 whole
    expect(by.Household).toBe(3000);
    expect("Gift" in by).toBe(false); // excluded split part not counted
  });

  it("monthly summary drops the excluded split part from the spending total", async () => {
    const s = await getMonthlySummary("2026-06", db);
    expect(s.spendingCents).toBe(11000); // 6000 + 3000 + 2000; gift 1000 excluded
    expect(s.incomeCents).toBe(200000);
  });

  it("budget vs actual counts the split part assigned to the budgeted category", async () => {
    const rows = await getBudgetVsActual("2026-06", db);
    expect(rows.find((r) => r.categoryName === "Groceries")?.spentCents).toBe(8000);
  });

  it("spending trend reflects splits (excluded part dropped)", async () => {
    const points = await getSpendingTrend("2026-06", 1, db);
    expect(points[0]).toMatchObject({ month: "2026-06", spendingCents: 11000, incomeCents: 200000 });
  });
});

describe("excluded categories share one spending and budget contract", () => {
  const ctx = setupTestDbPerTest("finance-excluded-budget-");
  let db: Db;
  let excludedId: string;

  beforeEach(async () => {
    db = ctx.db;
    const account = await mustGetOrCreateAccount("Exclusion contract", db);
    const included = await mustCreateCategory(
      {
        name: "Included budget",
        color: null,
        keywords: [],
        excludeFromSpending: false,
        monthlyBudgetCents: 10000,
      },
      db,
    );
    const excluded = await mustCreateCategory(
      {
        name: "Excluded budget",
        color: null,
        keywords: [],
        excludeFromSpending: false,
        monthlyBudgetCents: 20000,
      },
      db,
    );
    excludedId = excluded.id;
    await mustCreateCategory(
      {
        name: "Included zero spend",
        color: null,
        keywords: [],
        excludeFromSpending: false,
        monthlyBudgetCents: 30000,
      },
      db,
    );
    await expect(
      updateCategory(excludedId, { excludeFromSpending: true }, db),
    ).resolves.toEqual({ status: "updated", id: excludedId });

    await db.insert(transactions).values([
      {
        date: "2026-06-01",
        description: "INCLUDED OUTFLOW",
        amountCents: -1000,
        accountId: account.id,
        categoryId: included.id,
      },
      {
        date: "2026-06-02",
        description: "INCLUDED INFLOW",
        amountCents: 200,
        accountId: account.id,
        categoryId: included.id,
      },
      {
        date: "2026-06-03",
        description: "EXCLUDED OUTFLOW",
        amountCents: -2000,
        accountId: account.id,
        categoryId: excludedId,
      },
      {
        date: "2026-06-04",
        description: "EXCLUDED INFLOW",
        amountCents: 3000,
        accountId: account.id,
        categoryId: excludedId,
      },
      {
        date: "2026-06-05",
        description: "UNCATEGORIZED OUTFLOW",
        amountCents: -400,
        accountId: account.id,
        categoryId: null,
      },
      {
        date: "2026-06-06",
        description: "UNCATEGORIZED INFLOW",
        amountCents: 500,
        accountId: account.id,
        categoryId: null,
      },
      {
        id: "exclusion-split",
        date: "2026-06-07",
        description: "SPLIT OUTFLOW",
        amountCents: -5000,
        accountId: account.id,
        categoryId: null,
      },
    ]);
    await db.insert(transactionSplits).values([
      { transactionId: "exclusion-split", categoryId: included.id, amountCents: -3000 },
      { transactionId: "exclusion-split", categoryId: excludedId, amountCents: -2000 },
    ]);
  });

  it("omits excluded activity consistently while retaining included zero-spend budgets", async () => {
    const spending = await getMonthlySpendingByCategory("2026-06", db);
    expect(Object.fromEntries(spending.map((row) => [row.categoryName, row.spentCents])))
      .toEqual({ "Included budget": 4000, null: 400 });

    await expect(getMonthlySummary("2026-06", db)).resolves.toEqual({
      incomeCents: 700,
      spendingCents: 4400,
    });
    await expect(getSpendingTrend("2026-06", 1, db)).resolves.toEqual([
      { month: "2026-06", incomeCents: 700, spendingCents: 4400 },
    ]);

    const budgets = await getBudgetVsActual("2026-06", db);
    expect(budgets.map((row) => row.categoryName)).toEqual([
      "Included budget",
      "Included zero spend",
    ]);
    expect(budgets.map((row) => [row.categoryName, row.spentCents])).toEqual([
      ["Included budget", 4000],
      ["Included zero spend", 0],
    ]);
  });

  it("restores the saved budget and split-aware actual when the category is included again", async () => {
    await expect(
      updateCategory(excludedId, { excludeFromSpending: false }, db),
    ).resolves.toEqual({ status: "updated", id: excludedId });

    const excluded = (await getBudgetVsActual("2026-06", db)).find(
      (row) => row.categoryId === excludedId,
    );
    expect(excluded).toMatchObject({
      budgetCents: 20000,
      spentCents: 4000,
      remainingCents: 16000,
      overBudget: false,
    });
  });
});

describe("empty spending aggregate shapes", () => {
  const ctx = setupTestDb("finance-summary-empty-");

  it("returns finite zero and empty results", async () => {
    await expect(getMonthlySpendingByCategory("2026-06", ctx.db)).resolves.toEqual([]);
    await expect(getBudgetVsActual("2026-06", ctx.db)).resolves.toEqual([]);
    await expect(getMonthlySummary("2026-06", ctx.db)).resolves.toEqual({
      incomeCents: 0,
      spendingCents: 0,
    });
    await expect(getSpendingTrend("2026-06", 2, ctx.db)).resolves.toEqual([
      { month: "2026-05", incomeCents: 0, spendingCents: 0 },
      { month: "2026-06", incomeCents: 0, spendingCents: 0 },
    ]);
  });
});
