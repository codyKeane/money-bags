import { TransferCandidateList } from "@/components/TransferCandidateList";
import { getTransferCandidates } from "@/server/services/transaction-links";

export const dynamic = "force-dynamic";

export const metadata = { title: "Transfers" };

export default async function TransfersPage() {
  const candidates = await getTransferCandidates();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold">Transfers</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Review likely movements between your own accounts. Pairing keeps both ledger rows and
          exports intact while removing them from income, spending, budgets, and trends.
        </p>
      </div>
      <TransferCandidateList candidates={candidates} />
    </div>
  );
}
