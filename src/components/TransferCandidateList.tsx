"use client";

import Link from "next/link";
import { pairTransferAction } from "@/server/actions";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { formatCents } from "@/lib/money";
import { formatIsoDate } from "@/lib/month";
import type { TransferCandidate } from "@/server/services/transaction-links";

const TRANSFERS_FOCUS_ID = "transfer-candidates-heading";

export function TransferCandidateList({ candidates }: { candidates: TransferCandidate[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 id={TRANSFERS_FOCUS_ID} tabIndex={-1} className="text-sm font-medium">
        Possible transfers
      </h2>
      {candidates.length === 0 ? (
        <p className="text-sm text-ink-muted">No unpaired equal-and-opposite rows are within the three-day window.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {candidates.map((candidate) => (
            <li key={`${candidate.source.id}:${candidate.destination.id}`} className="rounded-lg border border-hairline bg-surface px-4 py-3">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto] md:items-center">
                <TransactionSummary row={candidate.source} currency={candidate.currency} />
                <span className="text-center text-xs text-ink-muted" aria-label={`${candidate.dateDistanceDays} day date difference`}>
                  ↔<br />{candidate.dateDistanceDays}d
                </span>
                <TransactionSummary row={candidate.destination} currency={candidate.currency} />
                <ConfirmButton
                  label="Pair"
                  prompt="Pair these rows as an internal transfer? Both rows stay in the ledger and export, but leave income and spending totals."
                  title="Pair transfer rows"
                  confirmLabel="Pair transfer"
                  pendingLabel="Pairing…"
                  successFocusId={TRANSFERS_FOCUS_ID}
                  onConfirm={async () => {
                    const result = await pairTransferAction(candidate.source.id, candidate.destination.id);
                    if (!result.ok) return result.error ?? "Could not pair transfer rows.";
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TransactionSummary({
  row,
  currency,
}: {
  row: TransferCandidate["source"];
  currency: string;
}) {
  return (
    <div className="min-w-0 text-sm">
      <p className="text-xs text-ink-muted">{row.accountName} · {formatIsoDate(row.date)}</p>
      <Link href={`/transactions/${row.id}/edit`} className="mt-1 block truncate underline underline-offset-2">
        {row.description}
      </Link>
      <p className="mt-1 tabular-nums">{formatCents(row.amountCents, currency)}</p>
    </div>
  );
}
