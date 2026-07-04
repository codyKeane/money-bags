import Link from "next/link";
import { AddTransactionSection } from "@/components/AddTransactionSection";
import { ApplyRulesButton } from "@/components/ApplyRulesButton";
import { TransactionFilters } from "@/components/TransactionFilters";
import { TransactionTable } from "@/components/TransactionTable";
import { isValidMonth } from "@/lib/month";
import { getAccountsWithBalances } from "@/server/services/accounts";
import {
  getAllCategories,
  getTransactionsPage,
} from "@/server/services/transactions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = first(params.q)?.trim() || undefined;
  const accountId = first(params.account) || undefined;
  const rawCategory = first(params.category) || undefined;
  const categoryId = rawCategory === "uncategorized" ? null : rawCategory;
  const rawMonth = first(params.month);
  const month = rawMonth && isValidMonth(rawMonth) ? rawMonth : undefined;
  const page = Math.max(1, parseInt(first(params.page) ?? "1", 10) || 1);

  const [{ items, totalCount }, accounts, categories] = await Promise.all([
    getTransactionsPage({
      q,
      accountId,
      categoryId,
      month,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getAccountsWithBalances(),
    getAllCategories(),
  ]);

  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name }));
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));

  const lastPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const from = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, totalCount);

  // Prev/Next links preserve the current filters.
  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (accountId) next.set("account", accountId);
    if (rawCategory) next.set("category", rawCategory);
    if (month) next.set("month", month);
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `/transactions?${qs}` : "/transactions";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Transactions</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Change a category to recategorize a single row.
          </p>
        </div>
        <ApplyRulesButton />
      </div>

      <AddTransactionSection accounts={accountOptions} categories={categoryOptions} />
      <TransactionFilters accounts={accountOptions} categories={categoryOptions} />

      <TransactionTable transactions={items} categories={categoryOptions} editable />

      <div className="flex items-center justify-between text-sm text-ink-muted">
        <span>
          Showing {from}–{to} of {totalCount}
        </span>
        <span className="inline-flex items-center gap-2">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="rounded-md border border-hairline bg-surface px-2 py-1 hover:bg-gridline/40">
              ← Prev
            </Link>
          ) : null}
          {page < lastPage ? (
            <Link href={pageHref(page + 1)} className="rounded-md border border-hairline bg-surface px-2 py-1 hover:bg-gridline/40">
              Next →
            </Link>
          ) : null}
        </span>
      </div>
    </div>
  );
}
