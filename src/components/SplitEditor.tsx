"use client";

import { useId, useRef, useState, useTransition } from "react";
import { clearSplitsAction, splitTransactionAction } from "@/server/actions";
import type { CategoryOption } from "@/components/CategorySelect";
import { FormError, inputClass } from "@/components/ui/form";
import { useSubmittedErrorFocus } from "@/components/ui/use-server-form";
import { centsToDecimalText, decimalTextToCents, formatCents } from "@/lib/money";

interface Row {
  id: number;
  categoryId: string; // "" = uncategorized
  amount: string; // signed dollars, as typed
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
  const alreadySplit = initialSplits.length > 0;
  const [rows, setRows] = useState<Row[]>(() =>
    alreadySplit
      ? initialSplits.map((s, index) => ({
          id: index,
          categoryId: s.categoryId ?? "",
          // Historical unsafe rows are left blank for explicit correction;
          // serializing them would round or throw before the warning renders.
          amount: Number.isSafeInteger(s.amountCents)
            ? centsToDecimalText(s.amountCents)
            : "",
        }))
      : [
          {
            id: 0,
            categoryId: "",
            amount: Number.isSafeInteger(amountCents)
              ? centsToDecimalText(amountCents)
              : "",
          },
          { id: 1, categoryId: "", amount: "" },
        ],
  );
  const nextRowId = useRef(alreadySplit ? initialSplits.length : 2);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const statusId = useId();
  const errorId = useId();
  const errorSummaryRef = useSubmittedErrorFocus(pending, Boolean(error));
  const transactionAmountLabel = Number.isSafeInteger(amountCents)
    ? formatCents(amountCents, currency)
    : "the stored transaction amount";

  // Live allocation math. A blank amount contributes nothing; a malformed one
  // makes the split unsaveable.
  const parsed = rows.map((r) =>
    r.amount.trim() === "" ? 0 : decimalTextToCents(r.amount),
  );
  const anyInvalid = parsed.some((c) => c === null);
  let allocated = 0;
  let arithmeticOverflow = !Number.isSafeInteger(amountCents);
  for (const cents of parsed) {
    if (cents === null) continue;
    const next = allocated + cents;
    if (!Number.isSafeInteger(next)) arithmeticOverflow = true;
    else allocated = next;
  }
  const remainder = amountCents - allocated;
  if (!Number.isSafeInteger(remainder)) arithmeticOverflow = true;
  const nonEmpty = rows.filter((r) => r.amount.trim() !== "");
  const canSave =
    !anyInvalid &&
    !arithmeticOverflow &&
    remainder === 0 &&
    nonEmpty.length >= 2;

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setError(null);
  }
  function addRow() {
    const id = nextRowId.current;
    nextRowId.current += 1;
    setRows((rs) => [
      ...rs,
      { id, categoryId: "", amount: "" },
    ]);
    setError(null);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, idx) => idx !== i)));
    setError(null);
  }

  function save() {
    setError(null);
    if (anyInvalid || arithmeticOverflow) {
      setError("Every split amount must be an exact, safe cent value.");
      return;
    }
    const parts = rows.flatMap((row, index) => {
      if (row.amount.trim() === "") return [];
      const amountCents = parsed[index];
      return amountCents === null || amountCents === undefined
        ? []
        : [{ categoryId: row.categoryId || null, amountCents }];
    });
    startTransition(async () => {
      const res = await splitTransactionAction(transactionId, parts);
      if (!res.ok) {
        setError(res.error ?? "Could not save the split.");
        return;
      }
    });
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      const res = await clearSplitsAction(transactionId);
      if (!res.ok) {
        setError(res.error ?? "Could not clear the split.");
      }
    });
  }

  return (
    <section className="flex max-w-xl flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3">
      <div>
        <h2 className="text-sm font-medium">Split across categories</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Divide {transactionAmountLabel} into parts
          that each land in their own category (e.g. one store run = groceries +
          household). Parts must add up to the total. While split, the parts —
          not the category above — drive all spending totals.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2 text-xs text-ink-2">
          <span className="flex-1">Category</span>
          <span className="w-28">Amount</span>
          <span className="w-11" />
        </div>
        {rows.map((row, i) => {
          const partNumber = i + 1;
          const categoryName =
            categories.find((category) => category.id === row.categoryId)
              ?.name ?? "Uncategorized";
          const amountInvalid = parsed[i] === null;

          return (
            <div key={row.id} className="flex items-center gap-2">
              <select
                value={row.categoryId}
                onChange={(e) => update(i, { categoryId: e.target.value })}
                className={`${inputClass} flex-1`}
                aria-label={`Split part ${partNumber} category, currently ${categoryName}`}
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
                aria-label={`Split part ${partNumber} amount for ${categoryName}`}
                aria-invalid={amountInvalid || undefined}
                aria-describedby={amountInvalid ? statusId : undefined}
                className={`${inputClass} w-28 tabular-nums`}
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={rows.length <= 1}
                aria-label={`Remove split part ${partNumber}, ${categoryName}`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-hairline px-2 py-1.5 text-xs text-ink-2 hover:bg-gridline/40 disabled:opacity-40"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex min-h-11 min-w-11 items-center px-2 text-ink-2 underline"
        >
          + Add part
        </button>
        <span
          id={statusId}
          className={
            remainder === 0 && !anyInvalid && !arithmeticOverflow
              ? "text-ink-muted"
              : "text-delta-bad"
          }
        >
          {anyInvalid
            ? "⚠ Enter exact amounts with at most two decimal places"
            : arithmeticOverflow
              ? "⚠ Split total is outside the safe cents range"
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
          aria-describedby={error ? errorId : undefined}
          className="inline-flex min-h-11 items-center rounded-md border border-hairline px-3 py-1 text-sm font-medium hover:bg-gridline/40 disabled:opacity-50"
        >
          {pending ? "Saving…" : alreadySplit ? "Update split" : "Save split"}
        </button>
        {alreadySplit ? (
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            aria-describedby={error ? errorId : undefined}
            className="inline-flex min-h-11 min-w-11 items-center px-2 text-xs text-ink-2 underline disabled:opacity-50"
          >
            Remove split
          </button>
        ) : null}
        <FormError id={errorId} error={error} summaryRef={errorSummaryRef} />
      </div>
    </section>
  );
}
