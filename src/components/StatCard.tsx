// Stat tile: label (sentence case) + value (semibold, proportional figures —
// tabular-nums is reserved for columns). Exact currency, not compact: this is
// a ledger, the cents are the point.
export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
