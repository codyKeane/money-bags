import Link from "next/link";
import { BudgetProgress } from "@/components/BudgetProgress";
import { MonthNav } from "@/components/MonthNav";
import { StatCard } from "@/components/StatCard";
import { TransactionTable } from "@/components/TransactionTable";
import { SpendingByCategoryChart } from "@/components/charts/SpendingByCategoryChart";
import { SpendingTrendChart } from "@/components/charts/SpendingTrendChart";
import { formatCents } from "@/lib/money";
import { currentUtcMonth, formatMonth, isValidMonth } from "@/lib/month";
import { getNetWorthOverview } from "@/server/services/accounts";
import {
  getBudgetVsActual,
  getMonthlySpendingByCategory,
  getMonthlySummary,
  getSpendingTrend,
} from "@/server/services/summary";
import {
  getLatestTransactionMonth,
  getRecentTransactions,
} from "@/server/services/transactions";

// Synchronous SQLite reads must never bake into a prerender.
export const dynamic = "force-dynamic";

// No title override here: the layout's title.template applies to child segments,
// not the root page, so the home tab shows the app-name default "Finance Engine"
// (the conventional home title); sub-pages get "<Page> · Finance Engine".

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.month) ? params.month[0] : params.month;
  const latest = await getLatestTransactionMonth();

  if (!latest) {
    return (
      <div className="rounded-lg border border-hairline bg-surface px-6 py-8 text-sm">
        <h1 className="text-lg font-semibold">Welcome to your finance engine</h1>
        <p className="mt-2 text-ink-2">There are no transactions yet. To get started:</p>
        <ul className="mt-2 list-disc pl-5 text-ink-2">
          <li>
            seed demo data: <code className="font-mono text-xs">npm run db:seed</code>, or
          </li>
          <li>
            <Link href="/import" className="underline">
              import a bank statement CSV
            </Link>
          </li>
        </ul>
      </div>
    );
  }

  // Default to the latest month that actually has data, not the wall-clock
  // month — a fresh setup should never open onto an empty dashboard.
  const month = requested && isValidMonth(requested) ? requested : latest;

  const [netWorth, summary, byCategory, budgets, trend, recent] = await Promise.all([
    getNetWorthOverview(),
    getMonthlySummary(month),
    getMonthlySpendingByCategory(month),
    getBudgetVsActual(month),
    getSpendingTrend(month >= currentUtcMonth() ? currentUtcMonth() : month, 6),
    getRecentTransactions(10),
  ]);

  const categoryData = byCategory.map((c) => ({
    name: c.categoryName ?? "Uncategorized",
    spentCents: c.spentCents,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <MonthNav month={month} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard href="/accounts" label="Net worth" value={formatCents(netWorth.netWorthCents)} />
        <StatCard
          label={`Income · ${formatMonth(month)}`}
          value={formatCents(summary.incomeCents)}
        />
        <StatCard
          label={`Spending · ${formatMonth(month)}`}
          value={formatCents(summary.spendingCents)}
        />
      </div>

      {netWorth.currencies.length > 1 ? (
        <p className="-mt-2 text-xs text-delta-bad">
          ⚠ Net worth sums accounts in different currencies (
          {netWorth.currencies.join(", ")}) as if they were one — the total is
          not meaningful. Keep one currency per install, or track them
          separately.
        </p>
      ) : null}

      <section className="rounded-lg border border-hairline bg-surface px-5 py-4">
        <h2 className="text-sm font-medium">Spending by category · {formatMonth(month)}</h2>
        <div className="mt-3">
          {categoryData.length > 0 ? (
            <SpendingByCategoryChart data={categoryData} />
          ) : (
            <p className="py-8 text-center text-sm text-ink-muted">
              No spending recorded for this month.
            </p>
          )}
        </div>
      </section>

      {budgets.length > 0 ? (
        <section className="rounded-lg border border-hairline bg-surface px-5 py-4">
          <h2 className="text-sm font-medium">Budget vs actual · {formatMonth(month)}</h2>
          <div className="mt-4">
            <BudgetProgress items={budgets} />
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-hairline bg-surface px-5 py-4">
        <h2 className="text-sm font-medium">Income vs spending · last 6 months</h2>
        <div className="mt-3">
          <SpendingTrendChart data={trend} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium">Recent transactions</h2>
        <div className="mt-3">
          <TransactionTable transactions={recent} />
        </div>
      </section>
    </div>
  );
}
