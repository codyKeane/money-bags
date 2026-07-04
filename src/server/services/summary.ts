import { and, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { categories, transactions } from "@/db/schema";
import { addMonths } from "@/lib/month";

// Transfers between own accounts (categories.excludeFromSpending) are neither
// income nor spending; uncategorized rows always count.
const countsTowardSpending = or(
  isNull(transactions.categoryId),
  eq(categories.excludeFromSpending, false),
);

const monthOf = sql<string>`substr(${transactions.date}, 1, 7)`;

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
    .where(
      and(
        sql`${monthOf} = ${month}`,
        lt(transactions.amountCents, 0),
        countsTowardSpending,
      ),
    )
    .groupBy(transactions.categoryId)
    .orderBy(sql`sum(${transactions.amountCents})`); // biggest spend first
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
    .where(and(sql`${monthOf} = ${month}`, countsTowardSpending));
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
        gte(monthOf, startMonth),
        lte(monthOf, endMonth),
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
