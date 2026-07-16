"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import {
  createAccountAction,
  deleteAccountAction,
  updateAccountAction,
  type CreateAccountState,
} from "@/server/actions";
import { ACCOUNT_TYPES } from "@/lib/account-types";
import { centsToDecimalText, formatCents } from "@/lib/money";
import { FlashMessage, useFlash } from "@/components/ui/flash";
import { Field, FormError, buttonClass, inputClass, rowActionClass, toggleButtonClass } from "@/components/ui/form";
import {
  useServerForm,
  useSubmittedErrorFocus,
} from "@/components/ui/use-server-form";
import { fieldErrorAttributes } from "@/components/ui/form-accessibility";
import {
  focusElementById,
  NEW_ACCOUNT_FOCUS_ID,
} from "@/components/ui/focus-target";
import {
  TableCard,
  bodyRowClass,
  headRowClass,
  thClass,
} from "@/components/ui/table";
import type { AccountWithBalance } from "@/server/services/accounts";

function AccountFields({
  initial,
  errorId,
  errorField,
}: {
  initial?: AccountWithBalance;
  errorId: string;
  errorField?: string;
}) {
  const currencyHelpId = useId();
  return (
    <>
      <Field label="Name">
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={initial?.name}
          className={inputClass}
          autoFocus
          {...fieldErrorAttributes(errorId, errorField, "name")}
        />
      </Field>
      <Field label="Type">
        <select
          name="type"
          defaultValue={initial?.type ?? "CHECKING"}
          className={inputClass}
          {...fieldErrorAttributes(errorId, errorField, "type")}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Institution (optional)">
        <input
          name="institution"
          maxLength={120}
          defaultValue={initial?.institution ?? ""}
          className={inputClass}
          {...fieldErrorAttributes(errorId, errorField, "institution")}
        />
      </Field>
      <Field label="Currency (three-letter code)">
        <input
          name="currency"
          required
          minLength={3}
          maxLength={3}
          pattern="[A-Za-z]{3}"
          autoCapitalize="characters"
          spellCheck={false}
          defaultValue={
            initial
              ? initial.currencyState.kind === "valid"
                ? initial.currencyState.currency
                : initial.rawCurrency
              : "USD"
          }
          className={inputClass}
          {...fieldErrorAttributes(errorId, errorField, "currency", currencyHelpId)}
        />
        <span id={currencyHelpId} className="text-xs text-ink-muted">
          Examples: USD, EUR, JPY. Saving an account always validates this code.
        </span>
      </Field>
      <Field label="Opening balance (signed dollars, e.g. -250.00)">
        <input
          name="openingBalance"
          inputMode="decimal"
          defaultValue={
            initial && Number.isSafeInteger(initial.openingBalanceCents)
              ? centsToDecimalText(initial.openingBalanceCents)
              : ""
          }
          placeholder="0.00"
          className={inputClass}
          {...fieldErrorAttributes(errorId, errorField, "openingBalance")}
        />
        {initial && !Number.isSafeInteger(initial.openingBalanceCents) ? (
          <span role="alert" className="text-xs text-delta-bad">
            The stored opening balance is outside the exact supported range. Enter a valid
            replacement before saving.
          </span>
        ) : null}
      </Field>
    </>
  );
}

function EditRow({ account, onDone }: { account: AccountWithBalance; onDone: () => void }) {
  const errorId = `${useId()}-error`;
  const [state, formAction, pending, errorSummaryRef] =
    useServerForm<CreateAccountState>(updateAccountAction, {
      onSuccess: onDone,
    });
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3">
      <input type="hidden" name="accountId" value={account.id} />
      <AccountFields
        initial={account}
        errorId={errorId}
        errorField={state.ok ? undefined : state.field}
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-ink-muted underline">
          Cancel
        </button>
        <FormError
          id={errorId}
          error={state.ok ? null : state.error}
          summaryRef={errorSummaryRef}
        />
      </div>
    </form>
  );
}

function DeleteRow({
  account,
  onCancel,
  onSuccess,
}: {
  account: AccountWithBalance;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<{
    message: string;
    typedNameMismatch: boolean;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = `${useId()}-typed-name`;
  const consequenceId = `${useId()}-consequence`;
  const errorId = `${useId()}-error`;
  const errorSummaryRef = useSubmittedErrorFocus(pending, Boolean(error));
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface px-4 py-3 text-sm"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <p id={consequenceId} className="text-ink-2">
        Deleting <strong>{account.name}</strong> permanently removes the account,
        its {account.transactionCount} transactions (including later edits and
        split allocations), and its import history. Data in other accounts and
        all categories remain.
      </p>
      <label htmlFor={inputId} className="text-sm text-ink-2">
        Type “{account.name}” to confirm
      </label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setError(null);
          }}
          autoFocus
          aria-invalid={error?.typedNameMismatch ? true : undefined}
          aria-describedby={`${consequenceId}${
            error?.typedNameMismatch ? ` ${errorId}` : ""
          }`}
          className={inputClass}
        />
        <button
          type="button"
          disabled={typed !== account.name || pending}
          aria-describedby={`${consequenceId}${error ? ` ${errorId}` : ""}`}
          className="inline-flex min-h-11 items-center rounded-md border border-delta-bad/50 px-3 py-1 text-sm text-delta-bad hover:bg-delta-bad/10 disabled:opacity-40"
          onClick={() =>
            // deleteAccountAction revalidates; no refresh needed (P2).
            startTransition(async () => {
              try {
                const result = await deleteAccountAction(account.id, typed);
                if (!result.ok) {
                  setError({
                    message: result.error ?? "Delete failed",
                    typedNameMismatch: result.field === "confirmName",
                  });
                }
                else onSuccess();
              } catch {
                setError({
                  message: "The account could not be deleted. Try again.",
                  typedNameMismatch: false,
                });
              }
            })
          }
        >
          {pending ? "Deleting…" : "Delete account"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="inline-flex min-h-11 items-center text-xs text-ink-muted underline disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      <FormError
        id={errorId}
        error={error?.message}
        summaryRef={errorSummaryRef}
      />
    </div>
  );
}

export function AccountsManager({ accounts }: { accounts: AccountWithBalance[] }) {
  const [showCreate, setShowCreate] = useState(accounts.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const createErrorId = `${useId()}-create-error`;

  const [message, flash] = useFlash();
  const [createState, createFormAction, createPending, createErrorSummaryRef] =
    useServerForm<CreateAccountState>(createAccountAction, {
      onSuccess: () => {
        setShowCreate(false);
        flash("Account created");
      },
    });

  function restoreRowDeleteTrigger(accountId: string) {
    setDeletingId(null);
    requestAnimationFrame(() =>
      focusElementById(`account-delete-${accountId}`, document),
    );
  }

  function focusAfterAccountDelete() {
    setDeletingId(null);
    if (focusElementById(NEW_ACCOUNT_FOCUS_ID, document)) return;
    requestAnimationFrame(() => focusElementById(NEW_ACCOUNT_FOCUS_ID, document));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          id={NEW_ACCOUNT_FOCUS_ID}
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className={toggleButtonClass}
        >
          {showCreate ? "Cancel" : "New account"}
        </button>
        <FlashMessage message={message} />
      </div>

      {showCreate ? (
        <form
          action={createFormAction}
          className="flex max-w-xl flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3"
        >
          <p className="text-sm font-medium">New account</p>
          <AccountFields
            errorId={createErrorId}
            errorField={createState.ok ? undefined : createState.field}
          />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={createPending} className={buttonClass}>
              {createPending ? "Creating…" : "Create account"}
            </button>
            <FormError
              id={createErrorId}
              error={createState.ok ? null : createState.error}
              summaryRef={createErrorSummaryRef}
            />
          </div>
        </form>
      ) : null}

      <TableCard>
        <thead>
          <tr className={headRowClass}>
            <th className={thClass}>Account</th>
            <th className={thClass}>Type</th>
            <th className={thClass}>Institution</th>
            <th className={`${thClass} text-right`}>Opening</th>
            <th className={`${thClass} text-right`}>Balance</th>
            <th className={`${thClass} text-right`}>Transactions</th>
            <th className={thClass} />
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} className={`${bodyRowClass} align-top`}>
              {editingId === a.id || deletingId === a.id ? (
                <td colSpan={7} className="px-3 py-3">
                  {editingId === a.id ? (
                    <EditRow account={a} onDone={() => setEditingId(null)} />
                  ) : (
                    <DeleteRow
                      account={a}
                      onCancel={() => restoreRowDeleteTrigger(a.id)}
                      onSuccess={focusAfterAccountDelete}
                    />
                  )}
                </td>
              ) : (
                <>
                  <td className="px-3 py-2 whitespace-nowrap font-medium">
                    <Link
                      href={`/transactions?account=${a.id}`}
                      className="underline decoration-hairline underline-offset-2 hover:decoration-ink-2"
                    >
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink-2">{a.type}</td>
                  <td className="px-3 py-2 text-ink-2">{a.institution ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {a.currencyState.kind === "valid" && Number.isSafeInteger(a.openingBalanceCents)
                      ? formatCents(a.openingBalanceCents, a.currencyState.currency)
                      : "Unavailable"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {a.currencyState.kind === "valid" && a.balanceCents !== null
                      ? formatCents(a.balanceCents, a.currencyState.currency)
                      : "Unavailable"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.transactionCount}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <span className="inline-flex items-center gap-3">
                      <button type="button" onClick={() => setEditingId(a.id)} className={rowActionClass}>
                        Edit
                      </button>
                      <button
                        id={`account-delete-${a.id}`}
                        type="button"
                        onClick={() => setDeletingId(a.id)}
                        className={rowActionClass}
                      >
                        Delete
                      </button>
                    </span>
                    {a.currencyState.kind === "invalid" ? (
                      <span className="mt-1 block text-xs text-delta-bad" role="status">
                        Currency needs repair. Edit this account before amounts can be shown.
                      </span>
                    ) : a.balanceState.kind === "unsafe" ? (
                      <span className="mt-1 block text-xs text-delta-bad" role="status">
                        Balance is outside the exact supported range.
                      </span>
                    ) : null}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </TableCard>
    </div>
  );
}
