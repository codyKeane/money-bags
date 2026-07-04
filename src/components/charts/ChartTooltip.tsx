"use client";

// Shared tooltip body: values lead (strong), labels follow; series keyed by a
// short stroke of the series color, never colored text. React's escaping
// keeps CSV-derived names safe.
export interface TooltipRow {
  key: string;
  label: string;
  value: string;
  color?: string;
}

export function ChartTooltip({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2 shadow-sm text-sm">
      <p className="text-xs text-ink-muted">{title}</p>
      {rows.map((row) => (
        <p key={row.key} className="mt-0.5 flex items-center gap-2">
          {row.color ? (
            <span
              aria-hidden
              className="inline-block h-0.5 w-3 rounded"
              style={{ backgroundColor: row.color }}
            />
          ) : null}
          <strong className="font-semibold">{row.value}</strong>
          <span className="text-ink-2">{row.label}</span>
        </p>
      ))}
    </div>
  );
}
