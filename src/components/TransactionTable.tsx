import Link from "next/link";
import { CategoryBadge } from "@/components/CategoryBadge";
import { CategorySelect, type CategoryOption } from "@/components/CategorySelect";
import { DeleteTransactionButton } from "@/components/DeleteTransactionButton";
import { TableCard, bodyRowClass, headRowClass, thClass } from "@/components/ui/table";
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
    </TableCard>
  );
}
