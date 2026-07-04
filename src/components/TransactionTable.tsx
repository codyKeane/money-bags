import Link from "next/link";
import { CategoryBadge } from "@/components/CategoryBadge";
import { CategorySelect, type CategoryOption } from "@/components/CategorySelect";
import { DeleteTransactionButton } from "@/components/DeleteTransactionButton";
import { formatCents } from "@/lib/money";
import type { TransactionListItem } from "@/server/services/transactions";

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
    <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-xs text-ink-muted">
            <th className="px-3 py-2 font-normal">Date</th>
            <th className="px-3 py-2 font-normal">Description</th>
            <th className="px-3 py-2 font-normal">Account</th>
            <th className="px-3 py-2 font-normal">Category</th>
            <th className="px-3 py-2 text-right font-normal">Amount</th>
            {editable ? <th className="px-3 py-2 font-normal" /> : null}
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id} className="border-b border-hairline last:border-b-0">
              <td className="px-3 py-2 whitespace-nowrap text-ink-2 tabular-nums">{t.date}</td>
              <td className="px-3 py-2">{t.description}</td>
              <td className="px-3 py-2 whitespace-nowrap text-ink-2">{t.accountName}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {categories ? (
                  <CategorySelect
                    transactionId={t.id}
                    categoryId={t.categoryId}
                    categories={categories}
                  />
                ) : (
                  <CategoryBadge name={t.categoryName} color={t.categoryColor} />
                )}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                {formatCents(t.amountCents, t.currency)}
              </td>
              {editable ? (
                <td className="px-3 py-2 whitespace-nowrap text-right">
                  <Link href={`/transactions/${t.id}/edit`} className="text-xs text-ink-2 underline">
                    Edit
                  </Link>
                  <span className="ml-3">
                    <DeleteTransactionButton transactionId={t.id} description={t.description} />
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
