"use client";

import { useState } from "react";
import { TransactionForm } from "@/components/TransactionForm";
import type { CategoryOption } from "@/components/CategorySelect";
import { FlashMessage, useFlash } from "@/components/ui/flash";
import { toggleButtonClass } from "@/components/ui/form";
import { ADD_TRANSACTION_FOCUS_ID } from "@/components/ui/focus-target";
import type { AccountCurrencyState } from "@/lib/currency";

export function AddTransactionSection({
  accounts,
  categories,
}: {
  accounts: { id: string; name: string; currencyState: AccountCurrencyState }[];
  categories: CategoryOption[];
}) {
  const [open, setOpen] = useState(false);
  const [message, flash] = useFlash();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          id={ADD_TRANSACTION_FOCUS_ID}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={toggleButtonClass}
        >
          {open ? "Cancel" : "Add transaction"}
        </button>
        <FlashMessage message={message} />
      </div>
      {open ? (
        <TransactionForm
          accounts={accounts}
          categories={categories}
          onDone={() => {
            setOpen(false);
            flash("Transaction added");
          }}
        />
      ) : null}
    </div>
  );
}
