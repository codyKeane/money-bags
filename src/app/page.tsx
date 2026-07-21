import Link from "next/link";
import { BudgetProgress } from "@/components/BudgetProgress";
import { MonthNav } from "@/components/MonthNav";
import { MerchantRollup } from "@/components/MerchantRollup";
import { StatCard } from "@/components/StatCard";
import { TransactionTable } from "@/components/TransactionTable";
import { SpendingByCategoryChart } from "@/components/charts/SpendingByCategoryChart";
import { SpendingTrendChart } from "@/components/charts/SpendingTrendChart";
import { formatCents } from "@/lib/money";
import { currentUtcMonth, formatMonth, isValidMonth } from "@/lib/month";
import { getNetWorthOverview } from "@/server/services/accounts";
import {
  getDashboardAggregateOverview,
  getDashboardCurrencyGroups,
} from "@/server/services/summary";
import {
  getLatestTransactionMonth,
  getRecentTransactions,
  getUncategorizedTransactionCount,
  transactionPageHref,
} from "@/server/services/transactions";
import type { NetWorthOverview } from "@/server/services/accounts";
import type { DashboardAggregateOverview } from "@/server/services/summary";

// Synchronous SQLite reads must never bake into a prerender.
export const dynamic = "force-dynamic";

// No title override here: the layout's title.template applies to child segments,
// not the root page, so the home tab shows the app-name default "Finance Engine"
// (the conventional home title); sub-pages get "<Page> · Finance Engine".

function CurrencyUnavailableNotice({
  overview,
  unsafeAggregate,
}: {
  overview: NetWorthOverview;
  unsafeAggregate: boolean;
}) {
  if (unsafeAggregate || overview.aggregateState.kind === "unsafe") {
    return (
      <div role="alert" className="rounded-lg border border-delta-bad/40 bg-delta-bad/5 px-5 py-4 text-sm">
        <p className="font-medium text-delta-bad">Combined financial totals are unavailable.</p>
        <p className="mt-1 text-ink-2">
          At least one total is outside the exact supported cents range. Individual safe account
          values remain available on the <Link href="/accounts" className="underline">Accounts page</Link>.
        </p>
      </div>
    );
  }
  if (overview.currencyState.kind === "mixed") {
    return (
      <div role="status" className="rounded-lg border border-hairline bg-surface px-5 py-4 text-sm">
        <p className="font-medium">Combined financial totals are unavailable.</p>
        <p className="mt-1 text-ink-2">
          Accounts use {overview.currencyState.currencies.join(", ")}. Money Bags does not convert
          currencies, so no cross-currency total is shown. Each exact currency group is displayed
          below. <Link href="/accounts" className="underline">View account balances</Link>.
        </p>
      </div>
    );
  }
  if (overview.currencyState.kind === "invalid") {
    return (
      <div role="alert" className="rounded-lg border border-delta-bad/40 bg-delta-bad/5 px-5 py-4 text-sm">
        <p className="font-medium text-delta-bad">Account currency needs repair.</p>
        <p className="mt-1 text-ink-2">
          Combined financial totals are hidden until these accounts have valid currencies:
        </p>
        <ul className="mt-2 list-disc pl-5 text-ink-2">
          {overview.currencyState.accounts.map((account) => (
            <li key={account.id}>
              {account.name} ({account.id})
            </li>
          ))}
        </ul>
        <Link href="/accounts" className="mt-2 inline-block underline">Repair account currencies</Link>
      </div>
    );
  }
  return null;
}

function DashboardFinancials({
  financials,
  month,
  netWorthCents,
}: {
  financials: DashboardAggregateOverview;
  month: string;
  netWorthCents: number | null;
}) {
  if (
    financials.aggregateState.kind !== "ready" ||
    financials.currencyState.kind !== "single" ||
    financials.summary.incomeCents === null ||
    financials.summary.spendingCents === null ||
    netWorthCents === null
  ) {
    return (
      <div role="alert" className="rounded-lg border border-delta-bad/40 bg-delta-bad/5 px-5 py-4 text-sm">
        <p className="font-medium text-delta-bad">This currency group is unavailable.</p>
        <p className="mt-1 text-ink-2">
          One or more values is outside the exact supported cents range. Review the individual
          accounts before relying on this group&apos;s totals.
        </p>
      </div>
    );
  }

  const categoryData = financials.byCategory.map((category) => ({
    name: category.categoryName ?? "Uncategorized",
    spentCents: category.spentCents,
  }));
  const currency = financials.currencyState.currency;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard href="/accounts" label="Net worth" value={formatCents(netWorthCents, currency)} />
        <StatCard
          label={`Income · ${formatMonth(month)}`}
          value={formatCents(financials.summary.incomeCents, currency)}
        />
        <StatCard
          label={`Spending · ${formatMonth(month)}`}
          value={formatCents(financials.summary.spendingCents, currency)}
        />
      </div>

      <section className="rounded-lg border border-hairline bg-surface px-5 py-4">
        <h2 className="text-sm font-medium">Spending by category · {formatMonth(month)}</h2>
        <div className="mt-3">
          {categoryData.length > 0 ? (
            <SpendingByCategoryChart data={categoryData} currency={currency} />
          ) : (
            <p className="py-8 text-center text-sm text-ink-muted">
              No spending recorded for this month.
            </p>
          )}
        </div>
      </section>

      {financials.budgets.length > 0 ? (
        <section className="rounded-lg border border-hairline bg-surface px-5 py-4">
          <h2 className="text-sm font-medium">Budget vs actual · {formatMonth(month)}</h2>
          <div className="mt-4">
            <BudgetProgress items={financials.budgets} currency={currency} />
          </div>
        </section>
      ) : null}

      <MerchantRollup items={financials.merchants} currency={currency} />

      <section className="rounded-lg border border-hairline bg-surface px-5 py-4">
        <h2 className="text-sm font-medium">Income vs spending · last 6 months</h2>
        <div className="mt-3">
          <SpendingTrendChart data={financials.trend} currency={currency} />
        </div>
      </section>
    </>
  );
}

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
        <p className="mt-2 text-ink-2">
          There are no transactions yet. Open{" "}
          <Link href="/import" className="underline">
            Import
          </Link>{" "}
          to load a bank statement CSV.
        </p>
      </div>
    );
  }

  // Default to the latest month that actually has data, not the wall-clock
  // month — a fresh setup should never open onto an empty dashboard.
  const month = requested && isValidMonth(requested) ? requested : latest;

  const netWorth = await getNetWorthOverview();
  const trendEndMonth = month >= currentUtcMonth() ? currentUtcMonth() : month;
  const [financials, recent, uncategorizedCount, currencyGroups] = await Promise.all([
    getDashboardAggregateOverview(
      month,
      trendEndMonth,
      netWorth,
    ),
    getRecentTransactions(10),
    getUncategorizedTransactionCount(),
    netWorth.currencyState.kind === "single"
      ? Promise.resolve([])
      : getDashboardCurrencyGroups(month, trendEndMonth, netWorth),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <MonthNav month={month} />
      </div>

      {uncategorizedCount > 0 ? (
        <section className="rounded-lg border border-hairline bg-surface px-5 py-4 text-sm">
          <h2 className="font-medium">Needs categorization</h2>
          <p className="mt-1 text-ink-2">
            {uncategorizedCount} uncategorized {uncategorizedCount === 1 ? "transaction" : "transactions"} across all months.{" "}
            <Link
              href={transactionPageHref({ categoryId: null }, 1)}
              className="font-medium text-ink underline"
            >
              Review uncategorized transactions
            </Link>
          </p>
        </section>
      ) : null}

      {netWorth.currencyState.kind === "mixed" ? (
        <CurrencyUnavailableNotice
          overview={netWorth}
          unsafeAggregate={financials.aggregateState.kind === "unsafe"}
        />
      ) : null}

      {financials.aggregateState.kind === "ready" && netWorth.currencyState.kind === "single" ? (
        <DashboardFinancials
          financials={financials}
          month={month}
          netWorthCents={netWorth.netWorthCents}
        />
      ) : currencyGroups.length > 0 ? (
        <div className="flex flex-col gap-5">
          {currencyGroups.map((group) => (
            <section key={group.currency} className="flex flex-col gap-4">
              <h2 className="text-base font-semibold">{group.currency} accounts</h2>
              <p className="text-sm text-ink-muted">
                {group.accountNames.join(", ")}
              </p>
              <DashboardFinancials
                financials={group.financials}
                month={month}
                netWorthCents={group.netWorthCents}
              />
            </section>
          ))}
        </div>
      ) : (
        <CurrencyUnavailableNotice
          overview={netWorth}
          unsafeAggregate={financials.aggregateState.kind === "unsafe"}
        />
      )}

      <section>
        <h2 className="text-sm font-medium">Recent transactions</h2>
        <div className="mt-3">
          <TransactionTable transactions={recent} />
        </div>
      </section>
    </div>
  );
}
