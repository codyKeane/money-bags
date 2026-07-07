"use client";

import { useState, useTransition } from "react";
import { undoImportAction } from "@/server/actions";
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
// that import added. The action revalidates /import, so the undone row drops on
// the server re-render carried in the response; no router.refresh (P2).
export function ImportHistory({ batches }: { batches: ImportHistoryRow[] }) {
  const [pending, startTransition] = useTransition();
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleUndo(row: ImportHistoryRow) {
    const noun = row.importedCount === 1 ? "transaction" : "transactions";
    const source = row.filename ? ` from ${row.filename}` : "";
    if (
      !window.confirm(
        `Undo this import? This permanently deletes the ${row.importedCount} ${noun} it added${source}.`,
      )
    ) {
      return;
    }
    setError(null);
    setUndoingId(row.id);
    startTransition(async () => {
      const res = await undoImportAction(row.id);
      if (!res.ok) setError(res.error ?? "Undo failed.");
      setUndoingId(null);
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Recent imports</h2>
      {batches.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No imports yet. Imported statements appear here so you can undo one if
          it went in wrong.
        </p>
      ) : (
        <>
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
              {batches.map((row) => (
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
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => handleUndo(row)}
                      className="text-xs text-ink-2 underline disabled:opacity-50"
                    >
                      {pending && undoingId === row.id ? "Undoing…" : "Undo"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableCard>
          {error ? <p className="text-sm text-ink-2">⚠ {error}</p> : null}
        </>
      )}
    </section>
  );
}
