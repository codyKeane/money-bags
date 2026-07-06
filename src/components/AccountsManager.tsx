"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  createAccountAction,
  deleteAccountAction,
  updateAccountAction,
  type CreateAccountState,
} from "@/server/actions";
import { ACCOUNT_TYPES } from "@/lib/account-types";
import { formatCents } from "@/lib/money";
import { Field, FormError, buttonClass, inputClass, toggleButtonClass } from "@/components/ui/form";
import { useServerForm } from "@/components/ui/use-server-form";
import {
  TableCard,
  bodyRowClass,
  headRowClass,
  thClass,
} from "@/components/ui/table";
import type { AccountWithBalance } from "@/server/services/accounts";

function AccountFields({ initial }: { initial?: AccountWithBalance }) {
  return (
    <>
      <Field label="Name">
        <input name="name" required maxLength={120} defaultValue={initial?.name} className={inputClass} />
      </Field>
      <Field label="Type">
        <select name="type" defaultValue={initial?.type ?? "CHECKING"} className={inputClass}>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Institution (optional)">
        <input name="institution" maxLength={120} defaultValue={initial?.institution ?? ""} className={inputClass} />
      </Field>
      <Field label="Opening balance (signed dollars, e.g. -250.00)">
        <input
          name="openingBalance"
          defaultValue={initial ? (initial.openingBalanceCents / 100).toFixed(2) : ""}
          placeholder="0.00"
          className={inputClass}
        />
      </Field>
    </>
  );
}

function EditRow({ account, onDone }: { account: AccountWithBalance; onDone: () => void }) {
  const [state, formAction, pending] = useServerForm<CreateAccountState>(updateAccountAction, {
    onSuccess: onDone,
  });
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3">
      <input type="hidden" name="accountId" value={account.id} />
      <AccountFields initial={account} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-ink-muted underline">
          Cancel
        </button>
        <FormError error={state.ok ? null : state.error} />
      </div>
    </form>
  );
}

function DeleteRow({ account, onDone }: { account: AccountWithBalance; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface px-4 py-3 text-sm">
      <p className="text-ink-2">
        Deleting <strong>{account.name}</strong> permanently removes its{" "}
        {account.transactionCount} transactions. Type the account name to confirm.
      </p>
      <div className="flex items-center gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={account.name}
          className={inputClass}
        />
        <button
          type="button"
          disabled={typed !== account.name || pending}
          className="rounded-md border border-hairline px-3 py-1 text-sm hover:bg-gridline/40 disabled:opacity-40"
          onClick={() =>
            // deleteAccountAction revalidates; no refresh needed (P2).
            startTransition(async () => {
              const result = await deleteAccountAction(account.id, typed);
              if (!result.ok) setError(result.error ?? "Failed");
              else onDone();
            })
          }
        >
          {pending ? "Deleting…" : "Delete account"}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-ink-muted underline">
          Cancel
        </button>
      </div>
      {error ? <p className="text-ink-2">⚠ {error}</p> : null}
    </div>
  );
}

export function AccountsManager({ accounts }: { accounts: AccountWithBalance[] }) {
  const [showCreate, setShowCreate] = useState(accounts.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [createState, createFormAction, createPending] = useServerForm<CreateAccountState>(
    createAccountAction,
    { onSuccess: () => setShowCreate(false) },
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button type="button" onClick={() => setShowCreate((v) => !v)} className={toggleButtonClass}>
          {showCreate ? "Cancel" : "New account"}
        </button>
      </div>

      {showCreate ? (
        <form
          action={createFormAction}
          className="flex max-w-xl flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3"
        >
          <p className="text-sm font-medium">New account</p>
          <AccountFields />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={createPending} className={buttonClass}>
              {createPending ? "Creating…" : "Create account"}
            </button>
            <FormError error={createState.ok ? null : createState.error} />
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
                    <DeleteRow account={a} onDone={() => setDeletingId(null)} />
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
                    {formatCents(a.openingBalanceCents, a.currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCents(a.balanceCents, a.currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.transactionCount}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button
                      type="button"
                      onClick={() => setEditingId(a.id)}
                      className="text-xs text-ink-2 underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingId(a.id)}
                      className="ml-3 text-xs text-ink-2 underline"
                    >
                      Delete
                    </button>
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
