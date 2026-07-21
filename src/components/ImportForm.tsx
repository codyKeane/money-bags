"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import {
  createAccountAction,
  overrideDuplicateImportAction,
  type CreateAccountState,
} from "@/server/actions";
import { ACCOUNT_TYPES } from "@/lib/account-types";
import { inspectCurrencyCode, type AccountCurrencyState } from "@/lib/currency";
import { formatCents } from "@/lib/money";
import { formatIsoDate } from "@/lib/month";
import { FlashMessage, useFlash } from "@/components/ui/flash";
import { Field, FormError, inputClass } from "@/components/ui/form";
import {
  useServerForm,
  useSubmittedErrorFocus,
} from "@/components/ui/use-server-form";
import { fieldErrorAttributes } from "@/components/ui/form-accessibility";
import type { SkippedRow } from "@/server/services/import";

export interface AccountOption {
  id: string;
  name: string;
  type: string;
  rawCurrency: string;
  currencyState: AccountCurrencyState;
}

interface ImportResponse {
  imported: number;
  skipped: SkippedRow[];
  account: { id: string; currency: string } | null;
  sourceFingerprint?: string;
  filename?: string | null;
}

interface ImportErrorResponse {
  error?: string;
  message?: string;
  errors?: { rowNumber: number; message: string }[];
  issues?: { message: string }[];
  field?: string;
}

function importFormField(field: string | undefined): string | undefined {
  if (field === "account" || field === "accountId") return "accountId";
  if (field === "csvText" || field === "filename") return "file";
  return field;
}

function DuplicateOverrideButton({
  accountId,
  filename,
  row,
}: {
  accountId: string;
  filename?: string | null;
  row: SkippedRow;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function override() {
    setError(null);
    startTransition(async () => {
      const response = await overrideDuplicateImportAction({
        accountId,
        sourceFingerprint: row.sourceFingerprint,
        sourceRowNumber: row.rowNumber,
        importHash: row.importHash,
        date: row.date,
        description: row.description,
        amountCents: row.amountCents,
        filename,
      });
      if (response.ok) setDone(true);
      else setError(response.error ?? "Could not import this duplicate.");
    });
  }

  if (done) return <span className="text-delta-good">Imported separately</span>;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={override}
        disabled={pending}
        className="min-h-9 rounded border border-hairline px-2 text-xs underline-offset-2 hover:underline disabled:opacity-50"
      >
        {pending ? "Importing…" : "Import separately"}
      </button>
      {error ? <span className="text-xs text-delta-bad">{error}</span> : null}
    </span>
  );
}

// Canonical field -> the label shown in the Advanced column-mapping section.
const COLUMN_FIELDS: { key: string; label: string }[] = [
  { key: "date", label: "Date column header" },
  { key: "description", label: "Description column header" },
  { key: "amount", label: "Amount column header" },
  { key: "debit", label: "Debit column header" },
  { key: "credit", label: "Credit column header" },
];

export function ImportForm({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const dateFormatRef = useRef<HTMLSelectElement>(null);
  const [accountId, setAccountId] = useState(
    accounts.find((account) => account.currencyState.kind === "valid")?.id ?? "",
  );
  const [showCreate, setShowCreate] = useState(accounts.length === 0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadErrorField, setUploadErrorField] = useState<string | undefined>();
  const [dateFormatError, setDateFormatError] = useState<string | null>(null);
  const uploadErrorId = `${useId()}-upload-error`;
  const createErrorId = `${useId()}-create-error`;
  const uploadErrorSummaryRef = useSubmittedErrorFocus(
    uploading,
    Boolean(uploadError),
  );

  const [message, flash] = useFlash();
  // createAccountAction revalidates /import, so the new account flows into the
  // RSC-provided `accounts` list on the re-render — no router.refresh (P2).
  const [createState, createFormAction, createPending, createErrorSummaryRef] =
    useServerForm<CreateAccountState>(createAccountAction, {
      onSuccess: (state) => {
        if (state.accountId) {
          setAccountId(state.accountId);
          setShowCreate(false);
          flash("Account created");
        }
      },
    });
  const resultCurrencyState = inspectCurrencyCode(result?.account?.currency);
  const uploadDateFieldError = fieldErrorAttributes(
    uploadErrorId,
    uploadErrorField,
    "dateFormat",
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    setUploadErrorField(undefined);
    setDateFormatError(null);
    setResult(null);
    const formData = new FormData(event.currentTarget);
    formData.set("accountId", accountId);
    // Collapse the per-field Advanced inputs into the single columnMap JSON the
    // route expects; drop the raw fields so they don't ride along unused.
    const columnMap: Record<string, string> = {};
    for (const { key } of COLUMN_FIELDS) {
      const value = formData.get(`col-${key}`);
      if (typeof value === "string" && value.trim()) columnMap[key] = value.trim();
      formData.delete(`col-${key}`);
    }
    if (Object.keys(columnMap).length > 0) {
      formData.set("columnMap", JSON.stringify(columnMap));
    }
    setUploading(true);
    try {
      const res = await fetch("/api/import", { method: "POST", body: formData });
      const body: unknown = await res.json();
      if (!res.ok) {
        const error = body as ImportErrorResponse;
        setUploadErrorField(importFormField(error.field));
        if (error.error === "date-format-required") {
          setDateFormatError(
            "This file has dates that could mean MM/DD or DD/MM. Choose the file's format and import again; nothing was saved.",
          );
          dateFormatRef.current?.focus();
        } else if (error.error === "invalid-file") {
          setUploadErrorField("file");
          const rows = [
            ...new Set(
              (error.errors ?? [])
                .map((issue) => issue.rowNumber)
                .filter((rowNumber) => rowNumber > 0),
            ),
          ];
          const shownRows = rows.slice(0, 5);
          const location =
            shownRows.length > 0
              ? ` on line${rows.length === 1 ? "" : "s"} ${shownRows.join(", ")}${rows.length > shownRows.length ? " and more" : ""}`
              : "";
          setUploadError(`The CSV contains invalid data or structure${location}. Nothing was saved.`);
        } else if (error.error === "invalid-column-map") {
          setUploadError(error.issues?.[0]?.message ?? "The column mapping is invalid.");
        } else {
          if (error.error === "file-too-large" || error.error === "unsupported-file") {
            setUploadErrorField("file");
          } else if (error.error === "unknown-account") {
            setUploadErrorField("accountId");
          }
          setUploadError(error.message ?? `Import failed (${res.status})`);
        }
        return;
      }
      const completed = body as ImportResponse;
      setResult(completed);
      // The upload posts to a route handler (not a Server Action), so a real
      // import still needs a client refresh; all-duplicate no-ops do not.
      if (completed.imported > 0) router.refresh();
    } catch {
      setUploadErrorField(undefined);
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
              {...fieldErrorAttributes(
                uploadErrorId,
                uploadErrorField,
                "accountId",
              )}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id} disabled={a.currencyState.kind === "invalid"}>
                  {a.name} ({a.type})
                  {a.currencyState.kind === "invalid" ? " — currency needs repair" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="inline-flex min-h-11 items-center text-xs text-ink-2 underline"
              onClick={() => setShowCreate((v) => !v)}
            >
              {showCreate ? "Cancel" : "New account…"}
            </button>
            <FlashMessage message={message} />
          </div>
          {accounts.length > 0 && !accounts.some((a) => a.currencyState.kind === "valid") ? (
            <p role="alert" className="text-sm text-delta-bad">
              Repair an account currency on the Accounts page before importing.
            </p>
          ) : null}
        </Field>

        <Field label="Statement CSV (max 5 MB)">
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="min-h-11 text-sm"
            {...fieldErrorAttributes(uploadErrorId, uploadErrorField, "file")}
          />
        </Field>

        <Field label="Date format in file">
          <select
            ref={dateFormatRef}
            name="dateFormat"
            defaultValue="auto"
            className={inputClass}
            aria-invalid={
              dateFormatError ? true : uploadDateFieldError["aria-invalid"]
            }
            aria-describedby={
              dateFormatError
                ? "import-date-format-error"
                : uploadDateFieldError["aria-describedby"]
            }
          >
            <option value="auto">Auto-detect</option>
            <option value="MDY">MM/DD/YYYY</option>
            <option value="DMY">DD/MM/YYYY</option>
          </select>
          {dateFormatError ? (
            <p id="import-date-format-error" role="alert" className="mt-1 text-sm text-delta-bad">
              ⚠ {dateFormatError}
            </p>
          ) : null}
        </Field>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="self-start text-xs text-ink-2 underline"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide column mapping" : "Advanced: column mapping"}
          </button>
          {showAdvanced ? (
            <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3">
              <p className="text-xs text-ink-muted">
                Only needed when auto-detection fails. Enter the exact header text
                from your CSV for each field; leave blank to auto-detect. Provide
                Amount, or Debit/Credit as a pair.
              </p>
              {COLUMN_FIELDS.map(({ key, label }) => (
                <Field key={key} label={label}>
                  <input
                    name={`col-${key}`}
                    className={inputClass}
                    autoComplete="off"
                  />
                </Field>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={uploading || !accountId}
          className="inline-flex min-h-11 items-center self-start rounded-md border border-hairline bg-surface px-4 py-1.5 text-sm font-medium hover:bg-gridline/40 disabled:opacity-50"
        >
          {uploading ? "Importing…" : "Import statement"}
        </button>
        <FormError
          id={uploadErrorId}
          error={uploadError}
          summaryRef={uploadErrorSummaryRef}
        />
      </form>

      {showCreate ? (
        <form
          action={createFormAction}
          className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3"
        >
          <p className="text-sm font-medium">New account</p>
          <Field label="Name">
            <input
              name="name"
              required
              maxLength={120}
              className={inputClass}
              autoFocus
              {...fieldErrorAttributes(
                createErrorId,
                createState.ok ? undefined : createState.field,
                "name",
              )}
            />
          </Field>
          <Field label="Type">
            <select
              name="type"
              defaultValue="CHECKING"
              className={inputClass}
              {...fieldErrorAttributes(
                createErrorId,
                createState.ok ? undefined : createState.field,
                "type",
              )}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Currency (three-letter code)">
            <input
              name="currency"
              required
              minLength={3}
              maxLength={3}
              pattern="[A-Za-z]{3}"
              defaultValue="USD"
              autoCapitalize="characters"
              spellCheck={false}
              className={inputClass}
              {...fieldErrorAttributes(
                createErrorId,
                createState.ok ? undefined : createState.field,
                "currency",
              )}
            />
          </Field>
          <button
            type="submit"
            disabled={createPending}
            className="inline-flex min-h-11 items-center self-start rounded-md border border-hairline px-3 py-1 text-sm hover:bg-gridline/40 disabled:opacity-50"
          >
            {createPending ? "Creating…" : "Create account"}
          </button>
          <FormError
            id={createErrorId}
            error={createState.ok ? null : createState.error}
            summaryRef={createErrorSummaryRef}
          />
        </form>
      ) : null}

      {result ? (
        <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm">
          <div role="status" aria-live="polite">
            <p className="font-medium">Import result</p>
            <p className="mt-1 text-ink-2">
              {result.imported} imported · {result.skipped.length} skipped as duplicates
            </p>
          </div>
          {result.skipped.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-ink-muted">
                Skipped rows matched an existing frozen import hash. If one is a
                real transaction that also appears in another file, you can keep
                it as a separate row with its source-file provenance.
              </p>
              <table className="mt-2 text-xs">
                <tbody>
                  {result.skipped.map((row) => (
                    <tr key={`${row.rowNumber}`}>
                      <td className="pr-3 text-ink-muted">line {row.rowNumber}</td>
                      <td className="pr-3 whitespace-nowrap tabular-nums" title={row.date}>
                        {formatIsoDate(row.date)}
                      </td>
                      <td className="pr-3 tabular-nums">
                        {resultCurrencyState.kind === "valid" ? (
                          formatCents(row.amountCents, resultCurrencyState.currency)
                        ) : (
                          <span className="text-delta-bad">Unavailable — repair currency</span>
                        )}
                      </td>
                      <td>{row.description}</td>
                      <td className="pl-3">
                        {result.account && row.sourceFingerprint ? (
                          <DuplicateOverrideButton
                            accountId={result.account.id}
                            filename={result.filename}
                            row={row}
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
