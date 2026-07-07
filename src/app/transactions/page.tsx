import Link from "next/link";
import { AddTransactionSection } from "@/components/AddTransactionSection";
import { ApplyRulesButton } from "@/components/ApplyRulesButton";
import { TransactionFilters } from "@/components/TransactionFilters";
import { TransactionTable } from "@/components/TransactionTable";
import { getAccountOptions } from "@/server/services/accounts";
import { getAllCategories } from "@/server/services/categories";
import { getTransactionsPage, parseTransactionQuery } from "@/server/services/transactions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Transactions" };

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
  const get = (key: string) => first(params[key]);
  const query = parseTransactionQuery(get);
  const page = Math.max(1, parseInt(get("page") ?? "1", 10) || 1);

  // Load the option lists first so we can drop filter ids that no longer exist
  // — a deleted account/category left in the URL would otherwise show a
  // confusing empty result. Mirrors the isValidMonth guard (F6).
  const [accounts, categories] = await Promise.all([getAccountOptions(), getAllCategories()]);
  const accountId =
    query.accountId && accounts.some((a) => a.id === query.accountId) ? query.accountId : undefined;
  // null (uncategorized) / undefined (any) are always valid; a real id must exist.
  const categoryId =
    query.categoryId == null || categories.some((c) => c.id === query.categoryId)
      ? query.categoryId
      : undefined;

  const { items, totalCount } = await getTransactionsPage({
    ...query,
    accountId,
    categoryId,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name }));
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));

  // Distinguish "no matches for the current filters" from "the ledger is empty"
  // so the empty state can point the user at the right next step. categoryId is
  // null when filtering for uncategorized — still an active filter.
  const hasActiveFilters = Boolean(
    query.q || accountId || categoryId !== undefined || query.month || query.from || query.to,
  );

  const lastPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const rowFrom = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rowTo = Math.min(page * PAGE_SIZE, totalCount);

  // Sanitized filter params, shared by Prev/Next and the CSV export link — dead
  // account/category ids and invalid month/date bounds are already dropped, so
  // links stay consistent with what the page actually shows.
  const rawCategory = get("category");
  const filterParams = () => {
    const sp = new URLSearchParams();
    if (query.q) sp.set("q", query.q);
    if (accountId) sp.set("account", accountId);
    if (rawCategory === "uncategorized") sp.set("category", "uncategorized");
    else if (categoryId) sp.set("category", categoryId);
    if (query.month) sp.set("month", query.month);
    if (query.from) sp.set("from", query.from);
    if (query.to) sp.set("to", query.to);
    return sp;
  };
  const pageHref = (target: number) => {
    const next = filterParams();
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `/transactions?${qs}` : "/transactions";
  };
  const exportQs = filterParams().toString();
  const exportHref = exportQs ? `/api/export?${exportQs}` : "/api/export";

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

      {items.length === 0 ? (
        <div className="rounded-lg border border-hairline bg-surface px-6 py-10 text-center text-sm">
          {hasActiveFilters ? (
            <>
              <p className="text-ink-2">No transactions match these filters.</p>
              <Link href="/transactions" className="mt-2 inline-block text-ink-2 underline">
                Clear filters
              </Link>
            </>
          ) : (
            <>
              <p className="text-ink-2">No transactions yet.</p>
              <p className="mt-1 text-ink-muted">
                Add one above, or{" "}
                <Link href="/import" className="underline">
                  import a statement
                </Link>
                .
              </p>
            </>
          )}
        </div>
      ) : (
        <TransactionTable transactions={items} categories={categoryOptions} editable />
      )}

      {totalCount > 0 ? (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          <span className="inline-flex items-center gap-3">
            <span>
              Showing {rowFrom}–{rowTo} of {totalCount}
            </span>
            <a
              href={exportHref}
              className="rounded-md border border-hairline bg-surface px-2 py-1 text-ink-2 hover:bg-gridline/40"
            >
              Export CSV
            </a>
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
      ) : null}
    </div>
  );
}
