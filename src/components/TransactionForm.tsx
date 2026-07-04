"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import {
  createTransactionAction,
  updateTransactionAction,
  type TransactionFormState,
} from "@/server/actions";
import type { CategoryOption } from "@/components/CategorySelect";

const inputClass = "rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm";

export interface TransactionFormInitial {
  transactionId: string;
  accountId: string;
  categoryId: string | null;
  date: string;
  description: string;
  amountCents: number;
}

export function TransactionForm({
  accounts,
  categories,
  initial,
  onDone,
}: {
  accounts: { id: string; name: string }[];
  categories: CategoryOption[];
  initial?: TransactionFormInitial; // present = edit mode
  onDone?: () => void; // create mode: collapse the form
}) {
  const router = useRouter();
  const mode = initial ? "edit" : "create";
  const [state, formAction, pending] = useActionState(
    async (prev: TransactionFormState, formData: FormData) => {
      const result = initial
        ? await updateTransactionAction(prev, formData)
        : await createTransactionAction(prev, formData);
      if (result.ok) {
        if (mode === "edit") router.push("/transactions");
        else onDone?.();
        router.refresh();
      }
      return result;
    },
    { ok: true },
  );

  return (
    <form
      action={formAction}
      className="flex max-w-xl flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3"
    >
      {initial ? <input type="hidden" name="transactionId" value={initial.transactionId} /> : null}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Account</span>
        <select name="accountId" required defaultValue={initial?.accountId ?? ""} className={inputClass}>
          {!initial ? <option value="">Select an account…</option> : null}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Date</span>
        <input type="date" name="date" required defaultValue={initial?.date} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Description</span>
        <input name="description" required maxLength={500} defaultValue={initial?.description} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Amount (signed dollars — negative = money out)</span>
        <input
          name="amount"
          required
          placeholder="-12.50"
          defaultValue={initial ? (initial.amountCents / 100).toFixed(2) : ""}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Category</span>
        <select name="categoryId" defaultValue={initial?.categoryId ?? ""} className={inputClass}>
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md border border-hairline px-3 py-1 text-sm font-medium hover:bg-gridline/40 disabled:opacity-50"
        >
          {pending ? "Saving…" : mode === "edit" ? "Save changes" : "Add transaction"}
        </button>
        {mode === "edit" ? (
          <button type="button" onClick={() => router.push("/transactions")} className="text-xs text-ink-muted underline">
            Cancel
          </button>
        ) : null}
        {!state.ok && state.error ? <span className="text-sm text-ink-2">⚠ {state.error}</span> : null}
      </div>
    </form>
  );
}
