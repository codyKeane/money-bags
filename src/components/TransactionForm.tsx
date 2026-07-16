"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";
import {
  createTransactionAction,
  updateTransactionAction,
  type TransactionFormState,
} from "@/server/actions";
import type { CategoryOption } from "@/components/CategorySelect";
import { Field, FormError, inputClass } from "@/components/ui/form";
import { useServerForm } from "@/components/ui/use-server-form";
import { fieldErrorAttributes } from "@/components/ui/form-accessibility";
import { centsToDecimalText } from "@/lib/money";
import type { AccountCurrencyState } from "@/lib/currency";

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
  accounts: { id: string; name: string; currencyState: AccountCurrencyState }[];
  categories: CategoryOption[];
  initial?: TransactionFormInitial; // present = edit mode
  onDone?: () => void; // create mode: collapse the form
}) {
  const router = useRouter();
  const errorId = `${useId()}-error`;
  const mode = initial ? "edit" : "create";
  const [state, formAction, pending, errorSummaryRef] =
    useServerForm<TransactionFormState>(
      (prev, formData) =>
        initial
          ? updateTransactionAction(prev, formData)
          : createTransactionAction(prev, formData),
      {
        // create: the action revalidates /transactions so the new row appears on
        // the re-render (no refresh); edit: navigating to the list re-renders it.
        onSuccess: () =>
          mode === "edit" ? router.push("/transactions") : onDone?.(),
      },
    );
  const errorField = state.ok ? undefined : state.field;

  return (
    <form
      action={formAction}
      className="flex max-w-xl flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3"
    >
      {initial ? <input type="hidden" name="transactionId" value={initial.transactionId} /> : null}
      <Field label="Account">
        <select
          name="accountId"
          required
          defaultValue={initial?.accountId ?? ""}
          className={inputClass}
          autoFocus
          {...fieldErrorAttributes(errorId, errorField, "accountId")}
        >
          {!initial ? <option value="">Select an account…</option> : null}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}{a.currencyState.kind === "invalid" ? " (currency needs repair)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Date">
        <input
          type="date"
          name="date"
          required
          defaultValue={initial?.date}
          className={inputClass}
          {...fieldErrorAttributes(errorId, errorField, "date")}
        />
      </Field>
      <Field label="Description">
        <input
          name="description"
          required
          maxLength={500}
          defaultValue={initial?.description}
          className={inputClass}
          {...fieldErrorAttributes(errorId, errorField, "description")}
        />
      </Field>
      <Field label="Amount (signed dollars — negative = money out)">
        <input
          name="amount"
          required
          inputMode="decimal"
          placeholder="-12.50"
          defaultValue={initial ? centsToDecimalText(initial.amountCents) : ""}
          className={inputClass}
          {...fieldErrorAttributes(errorId, errorField, "amount")}
        />
      </Field>
      <Field label="Category">
        <select
          name="categoryId"
          defaultValue={initial?.categoryId ?? ""}
          className={inputClass}
          {...fieldErrorAttributes(errorId, errorField, "categoryId")}
        >
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
          className="inline-flex min-h-11 items-center self-start rounded-md border border-hairline px-3 py-1 text-sm font-medium hover:bg-gridline/40 disabled:opacity-50"
        >
          {pending ? "Saving…" : mode === "edit" ? "Save changes" : "Add transaction"}
        </button>
        {mode === "edit" ? (
          <button type="button" onClick={() => router.push("/transactions")} className="text-xs text-ink-muted underline">
            Cancel
          </button>
        ) : null}
        <FormError
          id={errorId}
          error={state.ok ? null : state.error}
          summaryRef={errorSummaryRef}
        />
      </div>
    </form>
  );
}
