"use client";

import { useState } from "react";
import { TransactionForm } from "@/components/TransactionForm";
import type { CategoryOption } from "@/components/CategorySelect";

export function AddTransactionSection({
  accounts,
  categories,
}: {
  accounts: { id: string; name: string }[];
  categories: CategoryOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-hairline bg-surface px-3 py-1 text-sm font-medium hover:bg-gridline/40"
        >
          {open ? "Cancel" : "Add transaction"}
        </button>
      </div>
      {open ? (
        <TransactionForm
          accounts={accounts}
          categories={categories}
          onDone={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
