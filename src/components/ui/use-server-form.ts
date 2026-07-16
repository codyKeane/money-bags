"use client";

import { useActionState, useEffect, useRef } from "react";
import { shouldFocusSubmittedFailure } from "./form-accessibility";

export function useSubmittedErrorFocus<Element extends HTMLElement = HTMLParagraphElement>(
  pending: boolean,
  failed: boolean,
) {
  const summaryRef = useRef<Element>(null);
  const wasPending = useRef(false);
  useEffect(() => {
    const shouldFocus = shouldFocusSubmittedFailure(
      wasPending.current,
      pending,
      failed,
    );
    if (pending) wasPending.current = true;
    else {
      wasPending.current = false;
      if (shouldFocus) summaryRef.current?.focus();
    }
  }, [failed, pending]);
  return summaryRef;
}

// Wraps the useActionState pattern the 6 forms hand-rolled: run the action,
// call onSuccess when it reports ok, return [state, formAction, pending].
//
// It deliberately does NOT call router.refresh(): a Server Action's response
// already re-renders the current route via the revalidatePath() the action
// runs, so a follow-up refresh is a redundant second render (P2). The one
// exception is the import upload, which posts to a route handler via fetch()
// (not a Server Action) and keeps its own refresh.
//
// State types here are plain objects (never Promises), so `Awaited<S>` equals
// `S` at runtime — the casts bridge that for useActionState's signature.
export function useServerForm<S extends { ok: boolean; error?: string }>(
  action: (prev: S, formData: FormData) => Promise<S>,
  options?: { initial?: S; onSuccess?: (state: S) => void },
) {
  const initial = (options?.initial ?? { ok: true }) as Awaited<S>;
  const [state, formAction, pending] = useActionState(
    async (prev: Awaited<S>, formData: FormData): Promise<Awaited<S>> => {
      const result = await action(prev as S, formData);
      if (result.ok) options?.onSuccess?.(result);
      return result as Awaited<S>;
    },
    initial,
  );
  const errorSummaryRef = useSubmittedErrorFocus(pending, !state.ok);
  return [state, formAction, pending, errorSummaryRef] as const;
}
