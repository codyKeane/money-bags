"use client";

import { useState, useTransition } from "react";
import {
  setTransactionClearedAction,
  setTransactionSpendingExclusionAction,
} from "@/server/actions";

export function TransactionStatusControls({
  transactionId,
  cleared,
  excludeFromSpending,
}: {
  transactionId: string;
  cleared: boolean;
  excludeFromSpending: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleCleared() {
    setError(null);
    startTransition(async () => {
      const result = await setTransactionClearedAction(transactionId, !cleared);
      if (!result.ok) setError(result.error ?? "Could not update cleared state.");
    });
  }

  function toggleExclusion() {
    setError(null);
    startTransition(async () => {
      const result = await setTransactionSpendingExclusionAction(
        transactionId,
        !excludeFromSpending,
      );
      if (!result.ok) setError(result.error ?? "Could not update spending state.");
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
      <button
        type="button"
        disabled={pending}
        onClick={toggleCleared}
        className="inline-flex min-h-11 items-center rounded-md border border-hairline px-2 text-ink-2 hover:bg-gridline/40 disabled:opacity-50"
        aria-pressed={cleared}
      >
        {cleared ? "✓ Cleared" : "Mark cleared"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={toggleExclusion}
        className="inline-flex min-h-11 items-center rounded-md border border-hairline px-2 text-ink-2 hover:bg-gridline/40 disabled:opacity-50"
        aria-pressed={excludeFromSpending}
      >
        {excludeFromSpending ? "Excluded" : "Exclude"}
      </button>
      {error ? (
        <span role="alert" className="text-delta-bad">
          {error}
        </span>
      ) : null}
    </div>
  );
}
