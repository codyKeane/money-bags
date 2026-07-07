"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearSplitsAction, splitTransactionAction } from "@/server/actions";
import type { CategoryOption } from "@/components/CategorySelect";
import { inputClass } from "@/components/ui/form";
import { dollarsToCents, formatCents } from "@/lib/money";

interface Row {
  categoryId: string; // "" = uncategorized
  amount: string; // signed dollars, as typed
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function SplitEditor({
  transactionId,
  amountCents,
  currency,
  categories,
  initialSplits,
}: {
  transactionId: string;
  amountCents: number; // the total the parts must add up to
  currency: string;
  categories: CategoryOption[];
  initialSplits: { categoryId: string | null; amountCents: number }[];
}) {
  const router = useRouter();
  const alreadySplit = initialSplits.length > 0;
  const [rows, setRows] = useState<Row[]>(() =>
    alreadySplit
      ? initialSplits.map((s) => ({ categoryId: s.categoryId ?? "", amount: centsToInput(s.amountCents) }))
      : [
          { categoryId: "", amount: centsToInput(amountCents) },
          { categoryId: "", amount: "" },
        ],
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Live allocation math. A blank amount contributes nothing; a malformed one
  // makes the split unsaveable.
  const parsed = rows.map((r) => (r.amount.trim() === "" ? 0 : dollarsToCents(r.amount)));
  const anyInvalid = parsed.some((c) => c === null);
  const allocated = parsed.reduce<number>((acc, c) => acc + (c ?? 0), 0);
  const remainder = amountCents - allocated;
  const nonEmpty = rows.filter((r) => r.amount.trim() !== "");
  const canSave = !anyInvalid && remainder === 0 && nonEmpty.length >= 2;

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setError(null);
  }
  function addRow() {
    setRows((rs) => [...rs, { categoryId: "", amount: "" }]);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, idx) => idx !== i)));
    setError(null);
  }

  function save() {
    const parts = rows
      .filter((r) => r.amount.trim() !== "")
      .map((r) => ({ categoryId: r.categoryId || null, amountCents: dollarsToCents(r.amount) ?? 0 }));
    setError(null);
    startTransition(async () => {
      const res = await splitTransactionAction(transactionId, parts);
      if (!res.ok) {
        setError(res.error ?? "Could not save the split.");
        return;
      }
      // The action revalidates; refresh so this page re-renders with the saved
      // split (and the list picks up the split badge).
      router.refresh();
    });
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      const res = await clearSplitsAction(transactionId);
      if (!res.ok) {
        setError(res.error ?? "Could not clear the split.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="flex max-w-xl flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3">
      <div>
        <h2 className="text-sm font-medium">Split across categories</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Divide this {formatCents(amountCents, currency)} transaction into parts
          that each land in their own category (e.g. one store run = groceries +
          household). Parts must add up to the total. While split, the parts —
          not the category above — drive all spending totals.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2 text-xs text-ink-2">
          <span className="flex-1">Category</span>
          <span className="w-28">Amount</span>
          <span className="w-7" />
        </div>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={row.categoryId}
              onChange={(e) => update(i, { categoryId: e.target.value })}
              className={`${inputClass} flex-1`}
              aria-label="Split part category"
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              value={row.amount}
              onChange={(e) => update(i, { amount: e.target.value })}
              inputMode="decimal"
              placeholder="0.00"
              aria-label="Split part amount"
              className={`${inputClass} w-28 tabular-nums`}
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={rows.length <= 1}
              aria-label="Remove split part"
              className="w-7 rounded-md border border-hairline px-2 py-1.5 text-xs text-ink-2 hover:bg-gridline/40 disabled:opacity-40"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs">
        <button type="button" onClick={addRow} className="text-ink-2 underline">
          + Add part
        </button>
        <span className={remainder === 0 && !anyInvalid ? "text-ink-muted" : "text-delta-bad"}>
          {anyInvalid
            ? "⚠ One amount isn’t a number"
            : remainder === 0
              ? "Balanced ✓"
              : `Remainder: ${formatCents(remainder, currency)}`}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !canSave}
          className="rounded-md border border-hairline px-3 py-1 text-sm font-medium hover:bg-gridline/40 disabled:opacity-50"
        >
          {pending ? "Saving…" : alreadySplit ? "Update split" : "Save split"}
        </button>
        {alreadySplit ? (
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="text-xs text-ink-2 underline disabled:opacity-50"
          >
            Remove split
          </button>
        ) : null}
        {error ? <p className="text-sm text-ink-2">⚠ {error}</p> : null}
      </div>
    </section>
  );
}
