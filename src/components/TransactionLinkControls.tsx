"use client";

import Link from "next/link";
import { useId } from "react";
import {
  linkRefundAction,
  unlinkRefundAction,
  unpairTransferAction,
} from "@/server/actions";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { formatCents } from "@/lib/money";
import { formatIsoDate } from "@/lib/month";
import type {
  RefundCandidate,
  TransactionLinkState,
} from "@/server/services/transaction-links";

const LINK_CONTROLS_FOCUS_ID = "transaction-link-controls";

export function TransactionLinkControls({
  transactionId,
  amountCents,
  currency,
  state,
  refundCandidates,
}: {
  transactionId: string;
  amountCents: number;
  currency: string;
  state: TransactionLinkState;
  refundCandidates: RefundCandidate[];
}) {
  const headingId = `${useId()}-${LINK_CONTROLS_FOCUS_ID}`;
  return (
    <section id={LINK_CONTROLS_FOCUS_ID} className="flex max-w-xl flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3">
      <h2 id={headingId} tabIndex={-1} className="text-sm font-medium">Ledger relationships</h2>
      {state.transferPairId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>Paired as an internal transfer.</span>
          <ConfirmButton
            label="Unpair transfer"
            prompt="Unpair this transfer? Both rows will count toward their normal income/spending semantics again."
            confirmLabel="Unpair"
            pendingLabel="Unpairing…"
            successFocusId={headingId}
            onConfirm={async () => {
              const result = await unpairTransferAction(transactionId);
              if (!result.ok) return result.error ?? "Could not unpair transfer.";
            }}
          />
        </div>
      ) : null}

      {amountCents > 0 ? (
        <RefundRowForPositive
          transactionId={transactionId}
          currency={currency}
          state={state}
          candidates={refundCandidates}
          successFocusId={headingId}
        />
      ) : state.refundTransactionIds.length > 0 ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>This outflow has linked refunds:</p>
          <ul className="flex flex-col gap-2">
            {state.refundTransactionIds.map((refundId) => (
              <li key={refundId} className="flex flex-wrap items-center justify-between gap-3">
                <Link href={`/transactions/${refundId}/edit`} className="underline underline-offset-2">
                  Refund transaction {refundId}
                </Link>
                <ConfirmButton
                  label="Unlink"
                  prompt="Unlink this refund? The positive row will count as income again."
                  confirmLabel="Unlink refund"
                  pendingLabel="Unlinking…"
                  successFocusId={headingId}
                  onConfirm={async () => {
                    const result = await unlinkRefundAction(refundId);
                    if (!result.ok) return result.error ?? "Could not unlink refund.";
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {amountCents <= 0 && state.refundTransactionIds.length === 0 && !state.transferPairId ? (
        <p className="text-sm text-ink-muted">No transfer or refund relationship is linked.</p>
      ) : null}
    </section>
  );
}

function RefundRowForPositive({
  transactionId,
  currency,
  state,
  candidates,
  successFocusId,
}: {
  transactionId: string;
  currency: string;
  state: TransactionLinkState;
  candidates: RefundCandidate[];
  successFocusId: string;
}) {
  if (state.transferPairId) {
    return <p className="text-sm text-ink-muted">Transfer-linked rows cannot also be refunds.</p>;
  }
  if (state.refundOriginalTransactionId) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>
          Linked as a refund of{" "}
          <Link href={`/transactions/${state.refundOriginalTransactionId}/edit`} className="underline underline-offset-2">
            transaction {state.refundOriginalTransactionId}
          </Link>
        </span>
        <ConfirmButton
          label="Unlink refund"
          prompt="Unlink this refund? It will count as income again until you link it to an original outflow."
          confirmLabel="Unlink"
          pendingLabel="Unlinking…"
          successFocusId={successFocusId}
          onConfirm={async () => {
            const result = await unlinkRefundAction(transactionId);
            if (!result.ok) return result.error ?? "Could not unlink refund.";
          }}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>Link this positive row to the original outflow it refunds. A partial refund is allowed.</p>
      {candidates.length === 0 ? (
        <p className="text-ink-muted">No eligible same-account original outflows found.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <Link href={`/transactions/${candidate.id}/edit`} className="underline underline-offset-2">
                  {candidate.description}
                </Link>{" "}
                <span className="text-ink-muted">
                  ({formatIsoDate(candidate.date)} · {formatCents(candidate.amountCents, currency)} ·{" "}
                  {formatCents(candidate.remainingRefundCents, currency)} remaining)
                </span>
              </span>
              <ConfirmButton
                label="Link refund"
                prompt="Link this positive row to the selected outflow? Its amount will reduce spending instead of appearing as income."
                confirmLabel="Link"
                pendingLabel="Linking…"
                successFocusId={successFocusId}
                onConfirm={async () => {
                  const result = await linkRefundAction(transactionId, candidate.id);
                  if (!result.ok) return result.error ?? "Could not link refund.";
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
