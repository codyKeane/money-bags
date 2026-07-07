"use client";

import { useRouter } from "next/navigation";
import {
  createTransactionAction,
  updateTransactionAction,
  type TransactionFormState,
} from "@/server/actions";
import type { CategoryOption } from "@/components/CategorySelect";
import { Field, FormError, inputClass } from "@/components/ui/form";
import { useServerForm } from "@/components/ui/use-server-form";

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
  const [state, formAction, pending] = useServerForm<TransactionFormState>(
    (prev, formData) =>
      initial ? updateTransactionAction(prev, formData) : createTransactionAction(prev, formData),
    {
      // create: the action revalidates /transactions so the new row appears on
      // the re-render (no refresh); edit: navigating to the list re-renders it.
      onSuccess: () => (mode === "edit" ? router.push("/transactions") : onDone?.()),
    },
  );

  return (
    <form
      action={formAction}
      className="flex max-w-xl flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3"
    >
      {initial ? <input type="hidden" name="transactionId" value={initial.transactionId} /> : null}
      <Field label="Account">
        <select name="accountId" required defaultValue={initial?.accountId ?? ""} className={inputClass}>
          {!initial ? <option value="">Select an account…</option> : null}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Date">
        <input type="date" name="date" required defaultValue={initial?.date} className={inputClass} />
      </Field>
      <Field label="Description">
        <input name="description" required maxLength={500} defaultValue={initial?.description} className={inputClass} />
      </Field>
      <Field label="Amount (signed dollars — negative = money out)">
        <input
          name="amount"
          required
          inputMode="decimal"
          placeholder="-12.50"
          defaultValue={initial ? (initial.amountCents / 100).toFixed(2) : ""}
          className={inputClass}
        />
      </Field>
      <Field label="Category">
        <select name="categoryId" defaultValue={initial?.categoryId ?? ""} className={inputClass}>
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
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
        <FormError error={state.ok ? null : state.error} />
      </div>
    </form>
  );
}
