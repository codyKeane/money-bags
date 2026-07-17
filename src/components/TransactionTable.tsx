import Link from "next/link";
import { CategoryBadge } from "@/components/CategoryBadge";
import { CategorySelect, type CategoryOption } from "@/components/CategorySelect";
import { DeleteTransactionButton } from "@/components/DeleteTransactionButton";
import { rowActionClass } from "@/components/ui/form";
import { TableCard, bodyRowClass, headRowClass, thClass } from "@/components/ui/table";
import { formatCents } from "@/lib/money";
import { formatIsoDate } from "@/lib/month";
import type { TransactionListItem } from "@/server/services/transactions";

// Calm ledger (UX10): only money IN is tinted — income/refunds are the useful
// signal in a list that's mostly outflows — while outflows keep the default ink.
// That leaves the red danger token for things that actually need attention
// (errors, over-budget). The tint always sits beside the signed number, so the
// sign, not the hue, carries the meaning (CVD-safe palette rule).
function amountToneClass(cents: number): string {
  return cents > 0 ? "text-delta-good" : "";
}

// Server component. Pass `categories` to make the category column editable;
// `editable` adds per-row Edit/Delete (dashboard usage passes neither).
export function TransactionTable({
  transactions,
  categories,
  editable = false,
}: {
  transactions: TransactionListItem[];
  categories?: CategoryOption[];
  editable?: boolean;
}) {
  if (transactions.length === 0) {
    return <p className="text-sm text-ink-muted">No transactions found.</p>;
  }
  return (
    <TableCard>
      <thead>
          <tr className={headRowClass}>
            <th className={thClass}>Date</th>
            <th className={thClass}>Description</th>
            <th className={thClass}>Account</th>
            <th className={thClass}>Category</th>
            <th className={`${thClass} text-right`}>Amount</th>
            {editable ? <th className={thClass} /> : null}
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id} className={bodyRowClass}>
              <td className="px-3 py-2 whitespace-nowrap text-ink-2 tabular-nums" title={t.date}>
                {formatIsoDate(t.date)}
              </td>
              <td className="max-w-md px-3 py-2">
                <div>{t.description}</div>
                {t.notes ? (
                  <p
                    className="mt-1 line-clamp-2 whitespace-pre-line break-words text-xs text-ink-muted"
                    title={t.notes}
                  >
                    {t.notes}
                  </p>
                ) : null}
                {t.tags.length > 0 ? (
                  <ul
                    aria-label={`Tags for ${t.description}`}
                    className="mt-1 flex flex-wrap gap-1"
                  >
                    {t.tags.map((tag) => (
                      <li key={tag}>
                        <Link
                          href={`/transactions?tag=${encodeURIComponent(tag)}`}
                          className="inline-flex min-h-11 items-center rounded-full border border-hairline bg-gridline/30 px-2 py-0.5 text-xs text-ink-2 hover:bg-gridline/60"
                        >
                          #{tag}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-ink-2">
                <Link
                  href={`/transactions?account=${t.accountId}`}
                  className="underline decoration-hairline underline-offset-2 hover:decoration-ink-2"
                >
                  {t.accountName}
                </Link>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {t.isSplit ? (
                  // A split row's single categoryId is ignored by the aggregates,
                  // so offer the split (on the edit page) instead of a dropdown
                  // that would look like it did nothing.
                  <Link
                    href={`/transactions/${t.id}/edit`}
                    className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-2 underline decoration-hairline underline-offset-2 hover:decoration-ink-2"
                  >
                    <span aria-hidden>⧉</span> Split
                  </Link>
                ) : categories ? (
                  <CategorySelect
                    transactionId={t.id}
                    categoryId={t.categoryId}
                    categories={categories}
                  />
                ) : (
                  <CategoryBadge name={t.categoryName} color={t.categoryColor} />
                )}
              </td>
              <td
                className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${amountToneClass(t.amountCents)}`}
              >
                {t.currencyState.kind === "valid" && Number.isSafeInteger(t.amountCents) ? (
                  formatCents(t.amountCents, t.currencyState.currency)
                ) : (
                  <span className="text-delta-bad">
                    Unavailable
                    {t.currencyState.kind === "invalid" ? (
                      <Link href="/accounts" className="ml-2 underline">
                        Repair currency
                      </Link>
                    ) : null}
                  </span>
                )}
              </td>
              {editable ? (
                <td className="px-3 py-2 whitespace-nowrap text-right">
                  <span className="inline-flex items-center gap-3">
                    <Link href={`/transactions/${t.id}/edit`} className={rowActionClass}>
                      Edit
                    </Link>
                    <DeleteTransactionButton transactionId={t.id} description={t.description} />
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
    </TableCard>
  );
}
