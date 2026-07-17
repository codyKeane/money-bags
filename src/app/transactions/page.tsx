import Link from "next/link";
import { redirect } from "next/navigation";
import { AddTransactionSection } from "@/components/AddTransactionSection";
import { ApplyRulesButton } from "@/components/ApplyRulesButton";
import { TransactionFilters } from "@/components/TransactionFilters";
import { TransactionTable } from "@/components/TransactionTable";
import { getAccountOptions } from "@/server/services/accounts";
import { getAllCategories } from "@/server/services/categories";
import {
  getTransactionsPage,
  parseTransactionPage,
  parseTransactionQuery,
  transactionPageHref,
  transactionQuerySearchParams,
  TRANSACTIONS_PAGE_SIZE,
} from "@/server/services/transactions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Transactions" };

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
  const pageInput = parseTransactionPage(get("page"));

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

  // Dead ids and invalid date/month bounds are dropped before any canonical
  // redirect, pagination link, or export URL is built.
  const sanitizedQuery = { ...query, accountId, categoryId };
  const pageHref = (target: number) => transactionPageHref(sanitizedQuery, target);
  const rawTag = get("tag")?.trim() || undefined;
  if (pageInput.needsCanonicalRedirect || rawTag !== query.tag) redirect(pageHref(1));

  const { items, totalCount, page, lastPage } = await getTransactionsPage({
    ...sanitizedQuery,
    requestedPage: pageInput.requestedPage,
  });
  if (page !== pageInput.requestedPage) redirect(pageHref(page));

  const accountOptions = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    currencyState: a.currencyState,
  }));
  // color rides along so the in-row CategorySelect can show a matching dot (UX18).
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name, color: c.color }));

  // Distinguish "no matches for the current filters" from "the ledger is empty"
  // so the empty state can point the user at the right next step. categoryId is
  // null when filtering for uncategorized — still an active filter.
  const hasActiveFilters = Boolean(
    query.q || query.tag || accountId || categoryId !== undefined || query.month || query.from || query.to,
  );

  const rowFrom = totalCount === 0 ? 0 : (page - 1) * TRANSACTIONS_PAGE_SIZE + 1;
  const rowTo = Math.min(page * TRANSACTIONS_PAGE_SIZE, totalCount);
  const exportParams = transactionQuerySearchParams(sanitizedQuery);
  exportParams.set("format", "annotated");
  const exportHref = `/api/export?${exportParams.toString()}`;

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
      <TransactionFilters
        accounts={accountOptions.map(({ id, name }) => ({ id, name }))}
        categories={categoryOptions}
      />

      {items.length === 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-hairline bg-surface px-6 py-10 text-center text-sm"
        >
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
            <span role="status" aria-live="polite">
              Showing {rowFrom}–{rowTo} of {totalCount}
            </span>
            <a
              href={exportHref}
              className="inline-flex min-h-11 items-center rounded-md border border-hairline bg-surface px-2 py-1 text-ink-2 hover:bg-gridline/40"
            >
              Export CSV
            </a>
          </span>
          <span className="inline-flex items-center gap-2">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="inline-flex min-h-11 items-center rounded-md border border-hairline bg-surface px-2 py-1 hover:bg-gridline/40">
                ← Prev
              </Link>
            ) : null}
            {page < lastPage ? (
              <Link href={pageHref(page + 1)} className="inline-flex min-h-11 items-center rounded-md border border-hairline bg-surface px-2 py-1 hover:bg-gridline/40">
                Next →
              </Link>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
