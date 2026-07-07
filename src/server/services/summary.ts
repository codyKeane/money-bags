import { and, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import { getDb, type Db } from "@/db/client";
import { categories, transactions, transactionSplits } from "@/db/schema";
import { addMonths, monthRange, monthStart } from "@/lib/month";

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
  return db
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
// the number. Spend counts split parts assigned to the category, mirroring
// getMonthlySpendingByCategory.
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
  const points: TrendPoint[] = [];
  for (let i = 0; i < months; i++) {
    const month = addMonths(startMonth, i);
    points.push(byMonth.get(month) ?? { month, incomeCents: 0, spendingCents: 0 });
  }
  return points;
}
