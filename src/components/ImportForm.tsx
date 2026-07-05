"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createAccountAction, type CreateAccountState } from "@/server/actions";
import { ACCOUNT_TYPES } from "@/lib/account-types";
import { formatCents } from "@/lib/money";
import { Field, inputClass } from "@/components/ui/form";
import { useServerForm } from "@/components/ui/use-server-form";
import type { SkippedRow } from "@/server/services/import";

export interface AccountOption {
  id: string;
  name: string;
  type: string;
}

interface ImportResponse {
  imported: number;
  skipped: SkippedRow[];
  errors: { rowNumber: number; message: string }[];
}

export function ImportForm({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [showCreate, setShowCreate] = useState(accounts.length === 0);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // createAccountAction revalidates /import, so the new account flows into the
  // RSC-provided `accounts` list on the re-render — no router.refresh (P2).
  const [createState, createFormAction, createPending] = useServerForm<CreateAccountState>(
    createAccountAction,
    {
      onSuccess: (state) => {
        if (state.accountId) {
          setAccountId(state.accountId);
          setShowCreate(false);
        }
      },
    },
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    setResult(null);
    const formData = new FormData(event.currentTarget);
    formData.set("accountId", accountId);
    setUploading(true);
    try {
      const res = await fetch("/api/import", { method: "POST", body: formData });
      const body: unknown = await res.json();
      if (!res.ok) {
        setUploadError(
          (body as { error?: string }).error ?? `Import failed (${res.status})`,
        );
        return;
      }
      setResult(body as ImportResponse);
      // The upload posts to a route handler (not a Server Action), so its
      // revalidatePath doesn't refresh the client — this refresh is required.
      router.refresh();
    } catch {
      setUploadError("Import failed: could not reach the local server.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Account">
          <div className="flex items-center gap-2">
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={inputClass}
              required
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.type})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="text-xs text-ink-2 underline"
              onClick={() => setShowCreate((v) => !v)}
            >
              {showCreate ? "Cancel" : "New account…"}
            </button>
          </div>
        </Field>

        <Field label="Statement CSV (max 5 MB)">
          <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        </Field>

        <Field label="Date format in file">
          <select name="dateFormat" defaultValue="auto" className={inputClass}>
            <option value="auto">Auto-detect</option>
            <option value="MDY">MM/DD/YYYY</option>
            <option value="DMY">DD/MM/YYYY</option>
          </select>
        </Field>

        <button
          type="submit"
          disabled={uploading || !accountId}
          className="self-start rounded-md border border-hairline bg-surface px-4 py-1.5 text-sm font-medium hover:bg-gridline/40 disabled:opacity-50"
        >
          {uploading ? "Importing…" : "Import statement"}
        </button>
        {uploadError ? <p className="text-sm text-ink-2">⚠ {uploadError}</p> : null}
      </form>

      {showCreate ? (
        <form
          action={createFormAction}
          className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3"
        >
          <p className="text-sm font-medium">New account</p>
          <Field label="Name">
            <input name="name" required maxLength={120} className={inputClass} />
          </Field>
          <Field label="Type">
            <select name="type" defaultValue="CHECKING" className={inputClass}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="submit"
            disabled={createPending}
            className="self-start rounded-md border border-hairline px-3 py-1 text-sm hover:bg-gridline/40 disabled:opacity-50"
          >
            {createPending ? "Creating…" : "Create account"}
          </button>
          {!createState.ok && createState.error ? (
            <p className="text-sm text-ink-2">⚠ {createState.error}</p>
          ) : null}
        </form>
      ) : null}

      {result ? (
        <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm">
          <p className="font-medium">Import result</p>
          <p className="mt-1 text-ink-2">
            {result.imported} imported · {result.skipped.length} skipped as duplicates ·{" "}
            {result.errors.length} rows with errors
          </p>
          {result.skipped.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-ink-muted">
                Skipped rows (already imported). If one of these is a real
                transaction that also appears in another file, add it manually —
                identical rows split across files dedupe as one.
              </p>
              <table className="mt-2 text-xs">
                <tbody>
                  {result.skipped.map((row) => (
                    <tr key={`${row.rowNumber}`}>
                      <td className="pr-3 text-ink-muted">line {row.rowNumber}</td>
                      <td className="pr-3 tabular-nums">{row.date}</td>
                      <td className="pr-3 tabular-nums">{formatCents(row.amountCents)}</td>
                      <td>{row.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {result.errors.length > 0 ? (
            <ul className="mt-3 list-disc pl-5 text-xs text-ink-2">
              {result.errors.map((err) => (
                <li key={`${err.rowNumber}-${err.message}`}>
                  line {err.rowNumber}: {err.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
