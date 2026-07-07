"use client";

import { ConfirmButton } from "@/components/ui/confirm-button";
import { deleteTransactionAction } from "@/server/actions";

export function DeleteTransactionButton({
  transactionId,
  description,
}: {
  transactionId: string;
  description: string;
}) {
  return (
    <ConfirmButton
      label="Delete"
      prompt="Delete?"
      title={`Delete "${description}"`}
      confirmLabel="Delete"
      pendingLabel="Deleting…"
      // The action revalidates /transactions; the row drops on the server
      // re-render carried in the action response — no refresh needed (P2).
      onConfirm={async () => {
        const res = await deleteTransactionAction(transactionId);
        if (!res.ok) return res.error ?? "Delete failed";
      }}
    />
  );
}
