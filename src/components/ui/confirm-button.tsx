"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  INITIAL_CONFIRMATION_STATE,
  transitionConfirmation,
} from "./confirmation-state";
import { focusElementById } from "./focus-target";

// Inline, styled replacement for window.confirm (UX9). Clicking the trigger
// "arms" it in place, swapping to a danger Confirm + Cancel pair — no native
// browser dialog, and the destructive action keeps the app's look. onConfirm
// may return an error string (shown inline, danger color) or void/null on
// success. Every caller provides the full visible consequence and a focus target
// that survives the destructive server re-render; title is supplemental only.
export function ConfirmButton({
  label,
  prompt,
  title,
  confirmLabel = "Confirm",
  pendingLabel = "Working…",
  triggerClassName = "inline-flex min-h-11 items-center text-xs text-ink-2 underline underline-offset-2 disabled:opacity-50",
  successFocusId,
  onConfirm,
}: {
  label: string;
  prompt: string;
  title?: string;
  confirmLabel?: string;
  pendingLabel?: string;
  triggerClassName?: string;
  successFocusId: string;
  onConfirm: () => Promise<string | null | void> | string | null | void;
}) {
  const [confirmation, setConfirmation] = useState(INITIAL_CONFIRMATION_STATE);
  const { armed, error } = confirmation;
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restoreTrigger = useRef(false);
  const promptId = `${useId()}-prompt`;
  const errorId = `${useId()}-error`;

  useEffect(() => {
    if (armed && !pending) confirmRef.current?.focus();
    else if (restoreTrigger.current) {
      restoreTrigger.current = false;
      triggerRef.current?.focus();
    }
  }, [armed, pending]);

  function cancel() {
    if (pending) return;
    restoreTrigger.current = true;
    setConfirmation((state) =>
      transitionConfirmation(state, { type: "cancel" }),
    );
  }

  function focusSuccessDestination() {
    if (focusElementById(successFocusId, document)) return;
    requestAnimationFrame(() => focusElementById(successFocusId, document));
  }

  return (
    <span
      className="inline-flex flex-wrap items-center gap-2"
      onKeyDown={(event) => {
        if (armed && event.key === "Escape" && !pending) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      {armed ? (
        <>
          <span id={promptId} className="text-xs text-ink-2">{prompt}</span>
          <button
            ref={confirmRef}
            type="button"
            disabled={pending}
            aria-describedby={`${promptId}${error ? ` ${errorId}` : ""}`}
            className="inline-flex min-h-11 items-center rounded-md border border-delta-bad/50 px-2.5 py-1 text-xs font-medium text-delta-bad hover:bg-delta-bad/10 disabled:opacity-50"
            onClick={() =>
              startTransition(async () => {
                try {
                  const result = await onConfirm();
                  if (typeof result === "string") {
                    setConfirmation((state) =>
                      transitionConfirmation(state, { type: "fail", error: result }),
                    );
                    return;
                  }
                  setConfirmation((state) =>
                    transitionConfirmation(state, { type: "succeed" }),
                  );
                  focusSuccessDestination();
                } catch {
                  setConfirmation((state) =>
                    transitionConfirmation(state, {
                      type: "fail",
                      error: "The operation could not be completed. Try again.",
                    }),
                  );
                }
              })
            }
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={cancel}
            className="inline-flex min-h-11 items-center text-xs text-ink-muted underline"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          title={title}
          className={triggerClassName}
          onClick={() => {
            setConfirmation((state) =>
              transitionConfirmation(state, { type: "arm" }),
            );
          }}
        >
          {label}
        </button>
      )}
      {error ? (
        <span id={errorId} role="alert" aria-atomic="true" className="text-xs text-delta-bad">
          ⚠ {error}
        </span>
      ) : null}
    </span>
  );
}
