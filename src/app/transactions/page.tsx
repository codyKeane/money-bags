import Link from "next/link";
import { AddTransactionSection } from "@/components/AddTransactionSection";
import { ApplyRulesButton } from "@/components/ApplyRulesButton";
import { TransactionFilters } from "@/components/TransactionFilters";
import { TransactionTable } from "@/components/TransactionTable";
import { getAccountOptions } from "@/server/services/accounts";
import { getAllCategories } from "@/server/services/categories";
import { getTransactionsPage, parseTransactionQuery } from "@/server/services/transactions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// The raw filter params to carry across pagination / into the export link.
const FILTER_KEYS = ["q", "account", "category", "month", "from", "to"] as const;

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

  const [{ items, totalCount }, accounts, categories] = await Promise.all([
    getTransactionsPage({ ...query, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    getAccountOptions(),
    getAllCategories(),
  ]);

  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name }));
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));

  const lastPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const rowFrom = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rowTo = Math.min(page * PAGE_SIZE, totalCount);

  // Current filter params, shared by Prev/Next and the CSV export link.
  const filterParams = () => {
    const sp = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = get(key);
      if (value) sp.set(key, value);
    }
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

      <TransactionTable transactions={items} categories={categoryOptions} editable />

      <div className="flex items-center justify-between text-sm text-ink-muted">
        <span className="inline-flex items-center gap-3">
          <span>
            Showing {rowFrom}–{rowTo} of {totalCount}
          </span>
          {totalCount > 0 ? (
            <a
              href={exportHref}
              className="rounded-md border border-hairline bg-surface px-2 py-1 text-ink-2 hover:bg-gridline/40"
            >
              Export CSV
            </a>
          ) : null}
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
