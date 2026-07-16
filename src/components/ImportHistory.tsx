"use client";

import { undoImportAction } from "@/server/actions";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { RECENT_IMPORTS_FOCUS_ID } from "@/components/ui/focus-target";
import { TableCard, bodyRowClass, headRowClass, thClass } from "@/components/ui/table";

export interface ImportHistoryRow {
  id: string;
  accountName: string;
  filename: string | null;
  importedCount: number;
  skippedCount: number;
  createdAtLabel: string; // preformatted server-side to avoid TZ hydration drift
}

// Lists recent imports and lets the user undo one — deleting every transaction
// that import added. Undo is a styled inline confirm (UX9), not a native
// dialog; the action revalidates /import, so the undone row drops on the server
// re-render carried in the response — no router.refresh (P2).
export function ImportHistory({ batches }: { batches: ImportHistoryRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2
        id={RECENT_IMPORTS_FOCUS_ID}
        tabIndex={-1}
        className="text-sm font-medium"
      >
        Recent imports
      </h2>
      {batches.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No imports yet. Imported statements appear here so you can undo one if
          it went in wrong.
        </p>
      ) : (
        <TableCard>
          <thead>
            <tr className={headRowClass}>
              <th className={thClass}>When</th>
              <th className={thClass}>Account</th>
              <th className={thClass}>File</th>
              <th className={`${thClass} text-right`}>Added</th>
              <th className={thClass} />
            </tr>
          </thead>
          <tbody>
            {batches.map((row) => {
              const noun = row.importedCount === 1 ? "transaction" : "transactions";
              const source = row.filename ? ` from ${row.filename}` : "";
              return (
                <tr key={row.id} className={bodyRowClass}>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2 tabular-nums">
                    {row.createdAtLabel}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2">{row.accountName}</td>
                  <td className="px-3 py-2 text-ink-2">{row.filename ?? "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {row.importedCount}
                    {row.skippedCount > 0 ? (
                      <span className="text-ink-muted"> · {row.skippedCount} dup</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <ConfirmButton
                      label="Undo"
                      prompt={`Undo this import? This permanently deletes the ${row.importedCount} ${noun}${source}, including later edits and split allocations. Manually added transactions and other imports remain.`}
                      title={`Undo this import — permanently deletes the ${row.importedCount} ${noun} it added${source}`}
                      confirmLabel="Undo import"
                      pendingLabel="Undoing…"
                      successFocusId={RECENT_IMPORTS_FOCUS_ID}
                      onConfirm={async () => {
                        const res = await undoImportAction(row.id);
                        if (!res.ok) return res.error ?? "Undo failed.";
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableCard>
      )}
    </section>
  );
}
