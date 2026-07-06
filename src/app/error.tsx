"use client";

import { buttonClass } from "@/components/ui/form";

// Root error boundary for the app segment (App Router requires a client
// component). `reset` re-attempts the failed render. All ledger writes are
// transactional, so a render error never leaves partial data — say so plainly.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-6 py-8 text-sm">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-ink-2">
        An unexpected error occurred while loading this page. Your data is
        untouched — nothing was changed.
      </p>
      {error.digest ? (
        <p className="mt-1 font-mono text-xs text-ink-muted">Reference: {error.digest}</p>
      ) : null}
      <button type="button" onClick={reset} className={`mt-4 ${buttonClass}`}>
        Try again
      </button>
    </div>
  );
}
