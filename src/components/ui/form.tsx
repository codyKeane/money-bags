import type { ReactNode } from "react";

// Shared form primitives — extracted from the 5 hand-rolled forms
// (Category/Accounts managers, Transaction form, Import form, filters).
// Markup is byte-identical to what each site rendered before.

export const inputClass =
  "rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm";

// The common create/edit submit button (secondary style).
export const buttonClass =
  "rounded-md border border-hairline px-3 py-1 text-sm hover:bg-gridline/40 disabled:opacity-50";

// A toggle/primary button ("New category", "New account", "Add transaction").
export const toggleButtonClass =
  "rounded-md border border-hairline bg-surface px-3 py-1 text-sm font-medium hover:bg-gridline/40 disabled:opacity-50";

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
  return <span className="text-sm text-ink-2">⚠ {error}</span>;
}
