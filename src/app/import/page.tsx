import { ImportForm } from "@/components/ImportForm";
import { getAccountOptions } from "@/server/services/accounts";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const accounts = await getAccountOptions();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Import statement</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Upload a bank statement CSV. Re-importing the same file is safe —
          duplicates are skipped.
        </p>
      </div>
      <ImportForm
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))}
      />
    </div>
  );
}
