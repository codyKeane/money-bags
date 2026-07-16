import { and, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import { getDb, type Db } from "@/db/client";
import { categories, transactions, transactionSplits } from "@/db/schema";
import { addMonths, monthRange, monthStart } from "@/lib/month";
import type { CurrencyState } from "@/lib/currency";
import type { NetWorthOverview } from "./accounts";

export class UnsafeFinancialAggregateError extends RangeError {
  constructor(label: string) {
    super(`${label} is outside the exact supported cents range`);
    this.name = "UnsafeFinancialAggregateError";
  }
}

function assertSafeAggregate(label: string, ...values: number[]): void {
  if (values.some((value) => !Number.isSafeInteger(value))) {
    throw new UnsafeFinancialAggregateError(label);
  }
}

// Spending "line items" — the split-aware unit every spending aggregate reads.
// A transaction WITH splits contributes one line per split (its own categoryId
// is ignored); an unsplit transaction contributes a single line from its own
// category + amount. This is what lets one split part sit in an excluded
// category (e.g. a gift inside a store run) without pulling the whole
// transaction in or out of spending. The date filter is pushed into BOTH union
// branches so the transactions_date_idx range scan is preserved (P1).
function spendingLineItems(db: Db, start: string, endExclusive: string) {
  const inRange = and(
    gte(transactions.date, start),
    lt(transactions.date, endExclusive),
  );
  const splitLines = db
    .select({
      date: transactions.date,
      categoryId: transactionSplits.categoryId,
      amountCents: transactionSplits.amountCents,
    })
    .from(transactionSplits)
    .innerJoin(transactions, eq(transactionSplits.transactionId, transactions.id))
    .where(inRange);
  const wholeLines = db
    .select({
      date: transactions.date,
      categoryId: transactions.categoryId,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(
      and(
        inRange,
        sql`not exists (select 1 from ${transactionSplits} where ${transactionSplits.transactionId} = ${transactions.id})`,
      ),
    );
  return unionAll(splitLines, wholeLines).as("line_items");
}

type LineItems = ReturnType<typeof spendingLineItems>;

// Transfers between own accounts (categories.excludeFromSpending) are neither
// income nor spending; uncategorized lines always count. Built per query because
// it references the current line-items subquery's category column.
function countsTowardSpending(li: LineItems) {
  return or(isNull(li.categoryId), eq(categories.excludeFromSpending, false));
}

export interface CategorySpending {
  categoryId: string | null;
  categoryName: string | null; // null = uncategorized
  color: string | null;
  spentCents: number; // positive number of cents spent
}

export async function getMonthlySpendingByCategory(
  month: string,
  db: Db = getDb(),
): Promise<CategorySpending[]> {
  const { start, endExclusive } = monthRange(month);
  const li = spendingLineItems(db, start, endExclusive);
  const rows = await db
    .select({
      categoryId: li.categoryId,
      categoryName: categories.name,
      color: categories.color,
      spentCents: sql<number>`-sum(${li.amountCents})`,
    })
    .from(li)
    .leftJoin(categories, eq(li.categoryId, categories.id))
    .where(and(lt(li.amountCents, 0), countsTowardSpending(li)))
    .groupBy(li.categoryId)
    .orderBy(sql`sum(${li.amountCents})`); // biggest spend first
  for (const row of rows) assertSafeAggregate("category spending", row.spentCents);
  return rows;
}

export interface BudgetVsActual {
  categoryId: string;
  categoryName: string;
  color: string | null;
  budgetCents: number; // the target (positive)
  spentCents: number; // positive; 0 if nothing spent this month
  remainingCents: number; // budget - spent; negative once over budget
  overBudget: boolean;
}

// Every included category that has a monthlyBudgetCents set, paired with its
// actual outflow for the month. LEFT JOIN so a budgeted category with zero spend
// still appears; the negative-only filter lives INSIDE the aggregate (not WHERE)
// so it can't drop those zero-spend rows. Refunds (positive amounts) don't
// reduce the number. Spend counts split parts assigned to the category,
// mirroring getMonthlySpendingByCategory.
export async function getBudgetVsActual(
  month: string,
  db: Db = getDb(),
): Promise<BudgetVsActual[]> {
  const { start, endExclusive } = monthRange(month);
  const li = spendingLineItems(db, start, endExclusive);
  const rows = await db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      color: categories.color,
      budgetCents: categories.monthlyBudgetCents,
      spentCents: sql<number>`coalesce(-sum(case when ${li.amountCents} < 0 then ${li.amountCents} else 0 end), 0)`,
    })
    .from(categories)
    .leftJoin(li, eq(li.categoryId, categories.id))
    .where(
      and(
        isNotNull(categories.monthlyBudgetCents),
        eq(categories.excludeFromSpending, false),
      ),
    )
    .groupBy(categories.id)
    .orderBy(categories.name);

  return rows.map((r) => {
    const budgetCents = r.budgetCents ?? 0;
    assertSafeAggregate("budget progress", budgetCents, r.spentCents);
    const remainingCents = budgetCents - r.spentCents;
    assertSafeAggregate("budget progress", remainingCents);
    return {
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      color: r.color,
      budgetCents,
      spentCents: r.spentCents,
      remainingCents,
      overBudget: r.spentCents > budgetCents,
    };
  });
}

export interface MonthlySummary {
  incomeCents: number;
  spendingCents: number; // positive
}

export async function getMonthlySummary(month: string, db: Db = getDb()): Promise<MonthlySummary> {
  const { start, endExclusive } = monthRange(month);
  const li = spendingLineItems(db, start, endExclusive);
  const [row] = await db
    .select({
      incomeCents: sql<number>`coalesce(sum(case when ${li.amountCents} > 0 then ${li.amountCents} else 0 end), 0)`,
      spendingCents: sql<number>`coalesce(-sum(case when ${li.amountCents} < 0 then ${li.amountCents} else 0 end), 0)`,
    })
    .from(li)
    .leftJoin(categories, eq(li.categoryId, categories.id))
    .where(countsTowardSpending(li));
  const summary = row ?? { incomeCents: 0, spendingCents: 0 };
  assertSafeAggregate("monthly summary", summary.incomeCents, summary.spendingCents);
  return summary;
}

export interface TrendPoint {
  month: string;
  incomeCents: number;
  spendingCents: number; // positive
}

// One grouped query over the whole range; missing months zero-filled in JS so
// the chart never skips a month.
export async function getSpendingTrend(
  endMonth: string,
  months: number,
  db: Db = getDb(),
): Promise<TrendPoint[]> {
  const startMonth = addMonths(endMonth, -(months - 1));
  const li = spendingLineItems(
    db,
    monthStart(startMonth),
    monthStart(addMonths(endMonth, 1)),
  );
  // substr(date,1,7) is the month bucket key (SELECT/GROUP BY); the range filter
  // that hits the index already happened inside spendingLineItems (P1).
  const monthOf = sql<string>`substr(${li.date}, 1, 7)`;
  const rows = await db
    .select({
      month: monthOf.as("month"),
      incomeCents: sql<number>`coalesce(sum(case when ${li.amountCents} > 0 then ${li.amountCents} else 0 end), 0)`,
      spendingCents: sql<number>`coalesce(-sum(case when ${li.amountCents} < 0 then ${li.amountCents} else 0 end), 0)`,
    })
    .from(li)
    .leftJoin(categories, eq(li.categoryId, categories.id))
    .where(countsTowardSpending(li))
    .groupBy(monthOf)
    .orderBy(monthOf);

  const byMonth = new Map(rows.map((r) => [r.month, r]));
  for (const row of rows) {
    assertSafeAggregate("spending trend", row.incomeCents, row.spendingCents);
  }
  const points: TrendPoint[] = [];
  for (let i = 0; i < months; i++) {
    const month = addMonths(startMonth, i);
    points.push(byMonth.get(month) ?? { month, incomeCents: 0, spendingCents: 0 });
  }
  return points;
}

type SingleCurrencyState = Extract<CurrencyState, { kind: "single" }>;
type UnavailableSummary = { incomeCents: null; spendingCents: null };

export type MonthlySpendingOverview =
  | {
      currencyState: SingleCurrencyState;
      aggregateState: { kind: "ready" };
      summary: MonthlySummary;
      byCategory: CategorySpending[];
    }
  | {
      currencyState: CurrencyState;
      aggregateState: { kind: "unavailable" } | { kind: "unsafe" };
      summary: UnavailableSummary;
      byCategory: [];
    };

export async function getMonthlySpendingOverview(
  month: string,
  netWorth: NetWorthOverview,
  db: Db = getDb(),
): Promise<MonthlySpendingOverview> {
  if (netWorth.aggregateState.kind !== "ready") {
    return {
      currencyState: netWorth.currencyState,
      aggregateState: netWorth.aggregateState,
      summary: { incomeCents: null, spendingCents: null },
      byCategory: [],
    };
  }
  if (netWorth.currencyState.kind !== "single") {
    throw new Error("ready aggregate state requires one valid currency");
  }

  try {
    const [summary, byCategory] = await Promise.all([
      getMonthlySummary(month, db),
      getMonthlySpendingByCategory(month, db),
    ]);
    return {
      currencyState: netWorth.currencyState,
      aggregateState: { kind: "ready" },
      summary,
      byCategory,
    };
  } catch (error) {
    if (!(error instanceof UnsafeFinancialAggregateError)) throw error;
    return {
      currencyState: netWorth.currencyState,
      aggregateState: { kind: "unsafe" },
      summary: { incomeCents: null, spendingCents: null },
      byCategory: [],
    };
  }
}

export interface DashboardAggregateOverview {
  currencyState: CurrencyState;
  aggregateState: { kind: "ready" } | { kind: "unavailable" } | { kind: "unsafe" };
  summary: { incomeCents: number | null; spendingCents: number | null };
  byCategory: CategorySpending[];
  budgets: BudgetVsActual[];
  trend: TrendPoint[];
}

export async function getDashboardAggregateOverview(
  month: string,
  trendEndMonth: string,
  netWorth: NetWorthOverview,
  db: Db = getDb(),
): Promise<DashboardAggregateOverview> {
  const monthly = await getMonthlySpendingOverview(month, netWorth, db);
  if (monthly.aggregateState.kind !== "ready") {
    return { ...monthly, budgets: [], trend: [] };
  }

  try {
    const [budgets, trend] = await Promise.all([
      getBudgetVsActual(month, db),
      getSpendingTrend(trendEndMonth, 6, db),
    ]);
    return { ...monthly, budgets, trend };
  } catch (error) {
    if (!(error instanceof UnsafeFinancialAggregateError)) throw error;
    return {
      currencyState: monthly.currencyState,
      aggregateState: { kind: "unsafe" },
      summary: { incomeCents: null, spendingCents: null },
      byCategory: [],
      budgets: [],
      trend: [],
    };
  }
}
