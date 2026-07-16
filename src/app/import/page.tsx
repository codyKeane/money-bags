import { ImportForm } from "@/components/ImportForm";
import { ImportHistory } from "@/components/ImportHistory";
import { getAccountOptions } from "@/server/services/accounts";
import { getRecentImportBatches } from "@/server/services/import";

export const dynamic = "force-dynamic";

export const metadata = { title: "Import" };

// Compact local timestamp. Formatted here (server) rather than in the client
// component so the two renders can't disagree on timezone/locale.
const timestamp = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function ImportPage() {
  const [accounts, batches] = await Promise.all([
    getAccountOptions(),
    getRecentImportBatches(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Import statement</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Upload a bank statement CSV. Re-importing the same file is safe —
            duplicates are skipped.
          </p>
        </div>
        <ImportForm
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            rawCurrency: a.rawCurrency,
            currencyState: a.currencyState,
          }))}
        />
      </div>
      <ImportHistory
        batches={batches.map((b) => ({
          id: b.id,
          accountName: b.accountName,
          filename: b.filename,
          importedCount: b.importedCount,
          skippedCount: b.skippedCount,
          createdAtLabel: timestamp.format(new Date(b.createdAt)),
        }))}
      />
    </div>
  );
}
