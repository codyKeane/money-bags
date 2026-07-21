import { formatCents } from "@/lib/money";
import type { MerchantRollup as MerchantRollupItem } from "@/server/services/summary";

export function MerchantRollup({
  items,
  currency,
}: {
  items: MerchantRollupItem[];
  currency: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg border border-hairline bg-surface px-5 py-4">
      <h2 className="text-sm font-medium">Top merchants · last 6 months</h2>
      <ul className="mt-3 divide-y divide-hairline">
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-4 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate">{item.merchant}</span>
              <span className="text-xs text-ink-muted">
                {item.transactionCount} {item.transactionCount === 1 ? "transaction" : "transactions"}
                {item.recurring ? " · recurring" : ""}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{formatCents(item.spentCents, currency)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
