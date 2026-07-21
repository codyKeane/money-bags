import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import { getDb, type Db } from "@/db/client";
import { accounts, categories, refundLinks, transactions, transactionSplits, transferPairs } from "@/db/schema";
import { addMonths, monthRange, monthStart } from "@/lib/month";
import { merchantLabel } from "@/lib/merchant";
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
function spendingLineItems(
  db: Db,
  start: string,
  endExclusive: string,
  accountIds?: readonly string[],
) {
  const inRange = and(
    gte(transactions.date, start),
    lt(transactions.date, endExclusive),
  );
  const accountScope =
    accountIds === undefined
      ? undefined
      : accountIds.length > 0
        ? inArray(accounts.id, [...accountIds])
        : sql`0 = 1`;
  const splitLines = db
    .select({
      transactionId: transactions.id,
      date: transactions.date,
      description: transactions.description,
      merchant: transactions.merchant,
      categoryId: transactionSplits.categoryId,
      amountCents: transactionSplits.amountCents,
      isRefund: sql<number>`case when exists (
        select 1 from ${refundLinks}
        where ${refundLinks.refundTransactionId} = ${transactions.id}
      ) then 1 else 0 end`.as("is_refund"),
      excluded: sql<number>`case when ${transactions.excludeFromSpending} or exists (
        select 1 from ${transferPairs}
        where ${transferPairs.sourceTransactionId} = ${transactions.id}
           or ${transferPairs.destinationTransactionId} = ${transactions.id}
      ) then 1 else 0 end`.as("excluded"),
    })
    .from(transactionSplits)
    .innerJoin(transactions, eq(transactionSplits.transactionId, transactions.id))
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(inRange, accountScope));
  const wholeLines = db
    .select({
      transactionId: transactions.id,
      date: transactions.date,
      description: transactions.description,
      merchant: transactions.merchant,
      categoryId: transactions.categoryId,
      amountCents: transactions.amountCents,
      isRefund: sql<number>`case when exists (
        select 1 from ${refundLinks}
        where ${refundLinks.refundTransactionId} = ${transactions.id}
      ) then 1 else 0 end`.as("is_refund"),
      excluded: sql<number>`case when ${transactions.excludeFromSpending} or exists (
        select 1 from ${transferPairs}
        where ${transferPairs.sourceTransactionId} = ${transactions.id}
           or ${transferPairs.destinationTransactionId} = ${transactions.id}
      ) then 1 else 0 end`.as("excluded"),
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        inRange,
        accountScope,
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
  return and(
    eq(li.excluded, 0),
    or(isNull(li.categoryId), eq(categories.excludeFromSpending, false)),
  );
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
  accountIds?: readonly string[],
): Promise<CategorySpending[]> {
  const { start, endExclusive } = monthRange(month);
  const li = spendingLineItems(db, start, endExclusive, accountIds);
  const rows = await db
    .select({
      categoryId: li.categoryId,
      categoryName: categories.name,
      color: categories.color,
      spentCents: sql<number>`-sum(${li.amountCents})`,
    })
    .from(li)
    .leftJoin(categories, eq(li.categoryId, categories.id))
    .where(and(or(lt(li.amountCents, 0), eq(li.isRefund, 1)), countsTowardSpending(li)))
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
// so it can't drop those zero-spend rows. Unlinked positive rows do not reduce
// gross spend; an explicitly linked refund is included as a positive reduction
// using its own active category/splits. Spend counts split parts assigned to the
// category, mirroring getMonthlySpendingByCategory.
export async function getBudgetVsActual(
  month: string,
  db: Db = getDb(),
  accountIds?: readonly string[],
): Promise<BudgetVsActual[]> {
  const { start, endExclusive } = monthRange(month);
  const li = spendingLineItems(db, start, endExclusive, accountIds);
  const rows = await db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      color: categories.color,
      budgetCents: categories.monthlyBudgetCents,
      spentCents: sql<number>`coalesce(-sum(case when ${li.excluded} = 0 and (${li.amountCents} < 0 or ${li.isRefund} = 1) then ${li.amountCents} else 0 end), 0)`,
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

export async function getMonthlySummary(
  month: string,
  db: Db = getDb(),
  accountIds?: readonly string[],
): Promise<MonthlySummary> {
  const { start, endExclusive } = monthRange(month);
  const li = spendingLineItems(db, start, endExclusive, accountIds);
  const [row] = await db
    .select({
      incomeCents: sql<number>`coalesce(sum(case when ${li.amountCents} > 0 and ${li.isRefund} = 0 then ${li.amountCents} else 0 end), 0)`,
      spendingCents: sql<number>`coalesce(-sum(case when ${li.amountCents} < 0 or ${li.isRefund} = 1 then ${li.amountCents} else 0 end), 0)`,
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
  accountIds?: readonly string[],
): Promise<TrendPoint[]> {
  const startMonth = addMonths(endMonth, -(months - 1));
  const li = spendingLineItems(
    db,
    monthStart(startMonth),
    monthStart(addMonths(endMonth, 1)),
    accountIds,
  );
  // substr(date,1,7) is the month bucket key (SELECT/GROUP BY); the range filter
  // that hits the index already happened inside spendingLineItems (P1).
  const monthOf = sql<string>`substr(${li.date}, 1, 7)`;
  const rows = await db
    .select({
      month: monthOf.as("month"),
      incomeCents: sql<number>`coalesce(sum(case when ${li.amountCents} > 0 and ${li.isRefund} = 0 then ${li.amountCents} else 0 end), 0)`,
      spendingCents: sql<number>`coalesce(-sum(case when ${li.amountCents} < 0 or ${li.isRefund} = 1 then ${li.amountCents} else 0 end), 0)`,
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

export interface MerchantRollup {
  key: string;
  merchant: string;
  spentCents: number;
  transactionCount: number;
  monthCount: number;
  recurring: boolean;
}

// A rollup is read-only presentation data. It groups included negative line
// items across a bounded recent window; split parts contribute their amounts
// but a transaction is counted once per merchant.
export async function getMerchantRollup(
  endMonth: string,
  months = 6,
  limit = 25,
  db: Db = getDb(),
  accountIds?: readonly string[],
): Promise<MerchantRollup[]> {
  if (!Number.isSafeInteger(months) || months < 1 || months > 24) {
    throw new RangeError("Invalid merchant rollup month window");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Invalid merchant rollup limit");
  }
  const startMonth = addMonths(endMonth, -(months - 1));
  const li = spendingLineItems(
    db,
    monthStart(startMonth),
    monthStart(addMonths(endMonth, 1)),
    accountIds,
  );
  const rows = await db
    .select({
      transactionId: li.transactionId,
      date: li.date,
      description: li.description,
      merchant: li.merchant,
      amountCents: li.amountCents,
    })
    .from(li)
    .leftJoin(categories, eq(li.categoryId, categories.id))
    .where(and(or(lt(li.amountCents, 0), eq(li.isRefund, 1)), countsTowardSpending(li)));
  const grouped = new Map<
    string,
    { merchant: string; spentCents: number; transactions: Set<string>; months: Set<string> }
  >();
  for (const row of rows) {
    if (!isSafeAggregateValue(row.amountCents)) {
      throw new UnsafeFinancialAggregateError("merchant rollup");
    }
    const label = merchantLabel(row.merchant, row.description);
    const current = grouped.get(label.key);
    if (!current) {
      grouped.set(label.key, {
        merchant: label.label,
        spentCents: -row.amountCents,
        transactions: new Set([row.transactionId]),
        months: new Set([row.date.slice(0, 7)]),
      });
      continue;
    }
    const next = current.spentCents - row.amountCents;
    if (!Number.isSafeInteger(next)) {
      throw new UnsafeFinancialAggregateError("merchant rollup");
    }
    current.spentCents = next;
    current.transactions.add(row.transactionId);
    current.months.add(row.date.slice(0, 7));
  }
  return [...grouped.entries()]
    .map(([key, value]) => ({
      key,
      merchant: value.merchant,
      spentCents: value.spentCents,
      transactionCount: value.transactions.size,
      monthCount: value.months.size,
      recurring: value.months.size >= 3,
    }))
    .sort((left, right) => right.spentCents - left.spentCents || left.merchant.localeCompare(right.merchant))
    .slice(0, limit);
}

function isSafeAggregateValue(value: number): boolean {
  return Number.isSafeInteger(value);
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
  accountIds?: readonly string[],
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
      getMonthlySummary(month, db, accountIds),
      getMonthlySpendingByCategory(month, db, accountIds),
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
  merchants: MerchantRollup[];
}

export async function getDashboardAggregateOverview(
  month: string,
  trendEndMonth: string,
  netWorth: NetWorthOverview,
  db: Db = getDb(),
  accountIds?: readonly string[],
): Promise<DashboardAggregateOverview> {
  const monthly = await getMonthlySpendingOverview(month, netWorth, db, accountIds);
  if (monthly.aggregateState.kind !== "ready") {
    return { ...monthly, budgets: [], trend: [], merchants: [] };
  }

  try {
    const [budgets, trend, merchants] = await Promise.all([
      getBudgetVsActual(month, db, accountIds),
      getSpendingTrend(trendEndMonth, 6, db, accountIds),
      getMerchantRollup(trendEndMonth, 6, 25, db, accountIds),
    ]);
    return { ...monthly, budgets, trend, merchants };
  } catch (error) {
    if (!(error instanceof UnsafeFinancialAggregateError)) throw error;
    return {
      currencyState: monthly.currencyState,
      aggregateState: { kind: "unsafe" },
      summary: { incomeCents: null, spendingCents: null },
      byCategory: [],
      budgets: [],
      trend: [],
      merchants: [],
    };
  }
}

export interface DashboardCurrencyGroupOverview {
  currency: string;
  accountIds: string[];
  accountNames: string[];
  netWorthCents: number | null;
  financials: DashboardAggregateOverview;
}

// Mixed-currency dashboards stay exact by running the existing aggregate
// contract once per valid currency group. No conversion or cross-currency
// scalar is produced; each group carries its own account scope and currency.
export async function getDashboardCurrencyGroups(
  month: string,
  trendEndMonth: string,
  netWorth: NetWorthOverview,
  db: Db = getDb(),
): Promise<DashboardCurrencyGroupOverview[]> {
  return Promise.all(
    netWorth.currencyGroups.map(async (group) => {
      const scopedNetWorth: NetWorthOverview = {
        netWorthCents: group.netWorthCents,
        currencyState: { kind: "single", currency: group.currency },
        aggregateState: group.aggregateState,
        currencyGroups: [group],
      };
      const financials = await getDashboardAggregateOverview(
        month,
        trendEndMonth,
        scopedNetWorth,
        db,
        group.accountIds,
      );
      return { ...group, financials };
    }),
  );
}
