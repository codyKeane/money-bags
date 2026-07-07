import type { ReactNode } from "react";

// Shared form primitives — extracted from the 5 hand-rolled forms
// (Category/Accounts managers, Transaction form, Import form, filters).
// Markup is byte-identical to what each site rendered before.

// min-h-11 (44px) keeps inputs and buttons at the touch-target minimum on the
// mobile PWA (UX12); inline-flex + items-center vertically centers button text.
export const inputClass =
  "min-h-11 rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm";

// The common create/edit submit button (secondary style).
export const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-hairline px-3 py-1 text-sm hover:bg-gridline/40 disabled:opacity-50";

// A toggle/primary button ("New category", "New account", "Add transaction").
export const toggleButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-hairline bg-surface px-3 py-1 text-sm font-medium hover:bg-gridline/40 disabled:opacity-50";

// Compact per-row action link (Edit / Delete / Undo in table cells). min-h-11
// gives it a 44px tap target (UX12) without breaking the inline layout.
export const rowActionClass =
  "inline-flex min-h-11 items-center text-xs text-ink-2 underline underline-offset-2 disabled:opacity-50";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-ink-2">{label}</span>
      {children}
    </label>
  );
}

export function FormError({ error }: { error?: string | null }) {
  if (!error) return null;
  // Danger color (UX11), always paired with the ⚠ glyph + text — never color
  // alone (CVD-safe palette rule).
  return <span className="text-sm text-delta-bad">⚠ {error}</span>;
}
