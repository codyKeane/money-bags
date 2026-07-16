"use client";

import { ConfirmButton } from "@/components/ui/confirm-button";
import { ADD_TRANSACTION_FOCUS_ID } from "@/components/ui/focus-target";
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
      prompt={`Delete “${description}” permanently? Its split allocations are deleted with it. Other transactions remain.`}
      title={`Delete "${description}"`}
      confirmLabel="Delete"
      pendingLabel="Deleting…"
      successFocusId={ADD_TRANSACTION_FOCUS_ID}
      // The action revalidates /transactions; the row drops on the server
      // re-render carried in the action response — no refresh needed (P2).
      onConfirm={async () => {
        const res = await deleteTransactionAction(transactionId);
        if (!res.ok) return res.error ?? "Delete failed";
      }}
    />
  );
}
