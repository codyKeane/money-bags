"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import {
  createAccountAction,
  deleteAccountAction,
  updateAccountAction,
  type CreateAccountState,
} from "@/server/actions";
import { ACCOUNT_TYPES } from "@/lib/account-types";
import { formatCents } from "@/lib/money";
import type { AccountWithBalance } from "@/server/services/accounts";

const inputClass = "rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm";

function AccountFields({ initial }: { initial?: AccountWithBalance }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Name</span>
        <input name="name" required maxLength={120} defaultValue={initial?.name} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Type</span>
        <select name="type" defaultValue={initial?.type ?? "CHECKING"} className={inputClass}>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Institution (optional)</span>
        <input name="institution" maxLength={120} defaultValue={initial?.institution ?? ""} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Opening balance (signed dollars, e.g. -250.00)</span>
        <input
          name="openingBalance"
          defaultValue={initial ? (initial.openingBalanceCents / 100).toFixed(2) : ""}
          placeholder="0.00"
          className={inputClass}
        />
      </label>
    </>
  );
}

function EditRow({ account, onDone }: { account: AccountWithBalance; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(
    async (prev: CreateAccountState, formData: FormData) => {
      const result = await updateAccountAction(prev, formData);
      if (result.ok) onDone();
      return result;
    },
    { ok: true },
  );
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3">
      <input type="hidden" name="accountId" value={account.id} />
      <AccountFields initial={account} />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-hairline px-3 py-1 text-sm hover:bg-gridline/40 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-ink-muted underline">
          Cancel
        </button>
        {!state.ok && state.error ? <span className="text-sm text-ink-2">⚠ {state.error}</span> : null}
      </div>
    </form>
  );
}

function DeleteRow({ account, onDone }: { account: AccountWithBalance; onDone: () => void }) {
  const router = useRouter();
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
            startTransition(async () => {
              const result = await deleteAccountAction(account.id, typed);
              if (!result.ok) setError(result.error ?? "Failed");
              else {
                onDone();
                router.refresh();
              }
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
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(accounts.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [createState, createFormAction, createPending] = useActionState(
    async (prev: CreateAccountState, formData: FormData) => {
      const result = await createAccountAction(prev, formData);
      if (result.ok) {
        setShowCreate(false);
        router.refresh();
      }
      return result;
    },
    { ok: true },
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-md border border-hairline bg-surface px-3 py-1 text-sm font-medium hover:bg-gridline/40"
        >
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
            <button
              type="submit"
              disabled={createPending}
              className="rounded-md border border-hairline px-3 py-1 text-sm hover:bg-gridline/40 disabled:opacity-50"
            >
              {createPending ? "Creating…" : "Create account"}
            </button>
            {!createState.ok && createState.error ? (
              <span className="text-sm text-ink-2">⚠ {createState.error}</span>
            ) : null}
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-normal">Account</th>
              <th className="px-3 py-2 font-normal">Type</th>
              <th className="px-3 py-2 font-normal">Institution</th>
              <th className="px-3 py-2 text-right font-normal">Opening</th>
              <th className="px-3 py-2 text-right font-normal">Balance</th>
              <th className="px-3 py-2 text-right font-normal">Transactions</th>
              <th className="px-3 py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-b border-hairline last:border-b-0 align-top">
                {editingId === a.id || deletingId === a.id ? (
                  <td colSpan={7} className="px-3 py-3">
                    {editingId === a.id ? (
                      <EditRow
                        account={a}
                        onDone={() => {
                          setEditingId(null);
                          router.refresh();
                        }}
                      />
                    ) : (
                      <DeleteRow account={a} onDone={() => setDeletingId(null)} />
                    )}
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{a.name}</td>
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
        </table>
      </div>
    </div>
  );
}
