"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { applyRulesAction } from "@/server/actions";

// Re-runs keyword rules over uncategorized rows only (manual choices are
// never touched — enforced server-side).
export function ApplyRulesButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className="rounded-md border border-hairline bg-surface px-3 py-1 text-sm text-ink-2 hover:bg-gridline/40 disabled:opacity-50"
        onClick={() =>
          startTransition(async () => {
            const result = await applyRulesAction();
            setMessage(
              result.ok
                ? `Categorized ${result.updated} of ${result.scanned} uncategorized`
                : (result.error ?? "Failed"),
            );
            router.refresh();
          })
        }
      >
        {pending ? "Applying…" : "Apply rules to uncategorized"}
      </button>
      {message ? <span className="text-xs text-ink-muted">{message}</span> : null}
    </span>
  );
}
