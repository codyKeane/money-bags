import type { ReactNode } from "react";

// Shared table chrome — the exact class strings the three hand-rolled tables
// (Transaction, Category, Account) repeated. Kept as a wrapper + class
// constants rather than a column-config abstraction, because the manager
// tables need raw <tr>/colSpan access for their inline edit rows.

export const thClass = "px-3 py-2 font-normal";
export const headRowClass =
  "border-b border-hairline text-left text-xs text-ink-muted";
export const bodyRowClass = "border-b border-hairline last:border-b-0";

export function TableCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
