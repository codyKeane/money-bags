import { ColorDot } from "@/components/CategoryBadge";
import { formatCents } from "@/lib/money";
import type { BudgetVsActual } from "@/server/services/summary";

// Per-category budget bars for the dashboard. Track is neutral; the fill goes
// red (--delta-bad) once spend crosses the target so "over budget" never relies
// on color alone — the "Over by …" text carries the same signal.
function BudgetRow({ item }: { item: BudgetVsActual }) {
  const pct = item.budgetCents > 0 ? Math.min(100, (item.spentCents / item.budgetCents) * 100) : 0;
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <ColorDot color={item.color} />
          {item.categoryName}
        </span>
        <span className="tabular-nums text-ink-2">
          {formatCents(item.spentCents)} <span className="text-ink-muted">/ {formatCents(item.budgetCents)}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gridline" role="presentation">
        <div
          className={`h-full rounded-full ${item.overBudget ? "bg-delta-bad" : "bg-ink-2"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className={`text-xs ${item.overBudget ? "text-delta-bad" : "text-ink-muted"}`}>
        {item.overBudget
          ? `Over by ${formatCents(-item.remainingCents)}`
          : `${formatCents(item.remainingCents)} left`}
      </p>
    </li>
  );
}

export function BudgetProgress({ items }: { items: BudgetVsActual[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <BudgetRow key={item.categoryId} item={item} />
      ))}
    </ul>
  );
}
