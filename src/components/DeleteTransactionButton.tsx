"use client";

import { useTransition } from "react";
import { deleteTransactionAction } from "@/server/actions";

export function DeleteTransactionButton({
  transactionId,
  description,
}: {
  transactionId: string;
  description: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-ink-2 underline disabled:opacity-50"
      onClick={() => {
        if (!window.confirm(`Delete "${description}"?`)) return;
        // The action revalidates /transactions; the row drops on the server
        // re-render carried in the action response — no refresh needed (P2).
        startTransition(async () => {
          await deleteTransactionAction(transactionId);
        });
      }}
    >
      Delete
    </button>
  );
}
