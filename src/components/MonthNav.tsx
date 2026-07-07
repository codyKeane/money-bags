import Link from "next/link";
import { addMonths, currentUtcMonth, formatMonth } from "@/lib/month";

export function MonthNav({ month }: { month: string }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const atCurrent = month >= currentUtcMonth();
  const linkClass =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-hairline bg-surface px-2 py-1 text-sm text-ink-2 hover:bg-gridline/40";
  return (
    <div className="flex items-center gap-3">
      <Link href={`/?month=${prev}`} aria-label="Previous month" className={linkClass}>
        ←
      </Link>
      <span className="min-w-32 text-center text-sm font-medium">{formatMonth(month)}</span>
      {atCurrent ? (
        <span aria-hidden className={`${linkClass} opacity-40 select-none`}>
          →
        </span>
      ) : (
        <Link href={`/?month=${next}`} aria-label="Next month" className={linkClass}>
          →
        </Link>
      )}
    </div>
  );
}
