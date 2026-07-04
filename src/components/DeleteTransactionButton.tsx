"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteTransactionAction } from "@/server/actions";

export function DeleteTransactionButton({
  transactionId,
  description,
}: {
  transactionId: string;
  description: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-ink-2 underline disabled:opacity-50"
      onClick={() => {
        if (!window.confirm(`Delete "${description}"?`)) return;
        startTransition(async () => {
          await deleteTransactionAction(transactionId);
          router.refresh();
        });
      }}
    >
      Delete
    </button>
  );
}
