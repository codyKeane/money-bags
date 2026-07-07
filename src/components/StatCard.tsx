import Link from "next/link";

// Stat tile: label (sentence case) + value (semibold, proportional figures —
// tabular-nums is reserved for columns). Exact currency, not compact: this is
// a ledger, the cents are the point. Pass `href` to make the whole tile a link
// — it then shows a hover affordance (border lift + a → that fades in) so the
// clickable tile no longer looks identical to the static ones (UX17).
export function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const base = "rounded-lg border border-hairline bg-surface px-4 py-3";

  if (href) {
    return (
      <Link
        href={href}
        className={`group block transition-colors hover:border-baseline hover:bg-gridline/20 ${base}`}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-muted">{label}</p>
          <span
            aria-hidden
            className="text-sm text-ink-muted opacity-0 transition-opacity group-hover:opacity-100"
          >
            →
          </span>
        </div>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </Link>
    );
  }

  return (
    <div className={base}>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
