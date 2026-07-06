import { and, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { categories, transactions } from "@/db/schema";
import { addMonths, monthRange, monthStart } from "@/lib/month";

// Transfers between own accounts (categories.excludeFromSpending) are neither
// income nor spending; uncategorized rows always count.
const countsTowardSpending = or(
  isNull(transactions.categoryId),
  eq(categories.excludeFromSpending, false),
);

// substr(date,1,7) is the month bucket KEY (SELECT/GROUP BY). Month FILTERING
// uses a `date >= start AND date < end` range so it hits transactions_date_idx
// instead of scanning (P1). See monthRange() in src/lib/month.ts.
const monthOf = sql<string>`substr(${transactions.date}, 1, 7)`;

function inMonth(month: string) {
  const { start, endExclusive } = monthRange(month);
  return and(gte(transactions.date, start), lt(transactions.date, endExclusive));
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
  return db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      color: categories.color,
      spentCents: sql<number>`-sum(${transactions.amountCents})`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(inMonth(month), lt(transactions.amountCents, 0), countsTowardSpending))
    .groupBy(transactions.categoryId)
    .orderBy(sql`sum(${transactions.amountCents})`); // biggest spend first
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

// Every category that has a monthlyBudgetCents set, paired with its actual
// outflow for the month. LEFT JOIN so a budgeted category with zero spend still
// appears; the negative-only filter lives INSIDE the aggregate (not WHERE) so
// it can't drop those zero-spend rows. Refunds (positive amounts) don't reduce
// the number — spend mirrors getMonthlySpendingByCategory.
export async function getBudgetVsActual(
  month: string,
  db: Db = getDb(),
): Promise<BudgetVsActual[]> {
  const { start, endExclusive } = monthRange(month);
  const rows = await db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      color: categories.color,
      budgetCents: categories.monthlyBudgetCents,
      spentCents: sql<number>`coalesce(-sum(case when ${transactions.amountCents} < 0 then ${transactions.amountCents} else 0 end), 0)`,
    })
    .from(categories)
    .leftJoin(
      transactions,
      and(
        eq(transactions.categoryId, categories.id),
        gte(transactions.date, start),
        lt(transactions.date, endExclusive),
      ),
    )
    .where(isNotNull(categories.monthlyBudgetCents))
    .groupBy(categories.id)
    .orderBy(categories.name);

  return rows.map((r) => {
    const budgetCents = r.budgetCents ?? 0;
    return {
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      color: r.color,
      budgetCents,
      spentCents: r.spentCents,
      remainingCents: budgetCents - r.spentCents,
      overBudget: r.spentCents > budgetCents,
    };
  });
}

export interface MonthlySummary {
  incomeCents: number;
  spendingCents: number; // positive
}

export async function getMonthlySummary(month: string, db: Db = getDb()): Promise<MonthlySummary> {
  const [row] = await db
    .select({
      incomeCents: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end), 0)`,
      spendingCents: sql<number>`coalesce(-sum(case when ${transactions.amountCents} < 0 then ${transactions.amountCents} else 0 end), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(inMonth(month), countsTowardSpending));
  return row ?? { incomeCents: 0, spendingCents: 0 };
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
  const rows = await db
    .select({
      month: monthOf.as("month"),
      incomeCents: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end), 0)`,
      spendingCents: sql<number>`coalesce(-sum(case when ${transactions.amountCents} < 0 then ${transactions.amountCents} else 0 end), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        gte(transactions.date, monthStart(startMonth)),
        lt(transactions.date, monthStart(addMonths(endMonth, 1))),
        countsTowardSpending,
      ),
    )
    .groupBy(monthOf)
    .orderBy(monthOf);

  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const points: TrendPoint[] = [];
  for (let i = 0; i < months; i++) {
    const month = addMonths(startMonth, i);
    points.push(byMonth.get(month) ?? { month, incomeCents: 0, spendingCents: 0 });
  }
  return points;
}
