"use client";

import { useState, useTransition } from "react";

// Inline, styled replacement for window.confirm (UX9). Clicking the trigger
// "arms" it in place, swapping to a danger Confirm + Cancel pair — no native
// browser dialog, and the destructive action keeps the app's look. onConfirm
// may return an error string (shown inline, danger color) or void/null on
// success. The full context that a confirm() dialog used to spell out rides in
// `title` (hover tooltip) plus the short `prompt` shown when armed.
export function ConfirmButton({
  label,
  prompt,
  title,
  confirmLabel = "Confirm",
  pendingLabel = "Working…",
  triggerClassName = "inline-flex min-h-11 items-center text-xs text-ink-2 underline underline-offset-2 disabled:opacity-50",
  onConfirm,
}: {
  label: string;
  prompt?: string;
  title?: string;
  confirmLabel?: string;
  pendingLabel?: string;
  triggerClassName?: string;
  onConfirm: () => Promise<string | null | void> | string | null | void;
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {armed ? (
        <>
          {prompt ? <span className="text-xs text-ink-2">{prompt}</span> : null}
          <button
            type="button"
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-md border border-delta-bad/50 px-2.5 py-1 text-xs font-medium text-delta-bad hover:bg-delta-bad/10 disabled:opacity-50"
            onClick={() =>
              startTransition(async () => {
                const result = await onConfirm();
                if (typeof result === "string") setError(result);
                setArmed(false);
              })
            }
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setArmed(false)}
            className="inline-flex min-h-11 items-center text-xs text-ink-muted underline"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          title={title}
          className={triggerClassName}
          onClick={() => {
            setError(null);
            setArmed(true);
          }}
        >
          {label}
        </button>
      )}
      {error ? <span className="text-xs text-delta-bad">⚠ {error}</span> : null}
    </span>
  );
}
