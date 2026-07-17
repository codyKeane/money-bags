import Link from "next/link";
import { notFound } from "next/navigation";
import { SplitEditor } from "@/components/SplitEditor";
import { TransactionForm } from "@/components/TransactionForm";
import { formatCents } from "@/lib/money";
import { getAccountById, getAccountOptions } from "@/server/services/accounts";
import { getAllCategories } from "@/server/services/categories";
import { getSplitsForTransaction, getTransactionById } from "@/server/services/transactions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Edit transaction" };

function storedSplitTotal(
  parentAmountCents: number,
  splits: readonly { amountCents: number }[],
): { mismatched: boolean; splitTotalCents: number | null } {
  if (splits.length === 0) return { mismatched: false, splitTotalCents: 0 };
  let total = 0;
  for (const split of splits) {
    if (!Number.isSafeInteger(split.amountCents)) {
      return { mismatched: true, splitTotalCents: null };
    }
    const next = total + split.amountCents;
    if (!Number.isSafeInteger(next)) return { mismatched: true, splitTotalCents: null };
    total = next;
  }
  return {
    mismatched: !Number.isSafeInteger(parentAmountCents) || total !== parentAmountCents,
    splitTotalCents: total,
  };
}

export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const transaction = await getTransactionById(id);
  if (!transaction) notFound();

  const [accounts, categories, splits, account] = await Promise.all([
    getAccountOptions(),
    getAllCategories(),
    getSplitsForTransaction(transaction.id),
    getAccountById(transaction.accountId),
  ]);
  const splitIntegrity = storedSplitTotal(transaction.amountCents, splits);
  const transactionAmountIsSafe = Number.isSafeInteger(transaction.amountCents);
  const currency = account?.currencyState.kind === "valid" ? account.currencyState.currency : null;
  const parentAmountLabel = !transactionAmountIsSafe
    ? "stored transaction amount (outside the safe cents range)"
    : currency
      ? formatCents(transaction.amountCents, currency)
      : "stored transaction amount (currency needs repair)";

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/transactions"
        className="inline-flex min-h-11 items-center self-start text-sm text-ink-2 underline underline-offset-2"
      >
        ← Back to transactions
      </Link>
      <h1 className="text-lg font-semibold">Edit transaction</h1>
      {!transactionAmountIsSafe ? (
        <div
          role="alert"
          className="max-w-xl rounded-lg border border-delta-bad/40 bg-delta-bad/5 px-4 py-3 text-sm text-delta-bad"
        >
          <p className="font-medium">This stored amount is outside the exact supported range.</p>
          <p className="mt-1">
            It cannot be safely displayed or edited in place. Return to the transaction list to
            remove it after reviewing the source, then add or import a valid exact amount.
          </p>
        </div>
      ) : splitIntegrity.mismatched ? (
        <div
          role="alert"
          className="max-w-xl rounded-lg border border-delta-bad/40 bg-delta-bad/5 px-4 py-3 text-sm text-delta-bad"
        >
          <p className="font-medium">Saved split allocations do not match this transaction.</p>
          <p className="mt-1">
            Transaction detail edits are blocked. Review the allocations below and make them add
            up to the unchanged {parentAmountLabel}, or remove the split after reviewing it.
            {splitIntegrity.splitTotalCents === null
              ? " The saved allocation total is outside the safe cents range."
              : currency
                ? ` The saved allocations currently total ${formatCents(splitIntegrity.splitTotalCents, currency)}.`
                : " The saved allocation total cannot be formatted until the account currency is repaired."}
          </p>
        </div>
      ) : (
        <TransactionForm
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            currencyState: a.currencyState,
          }))}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          initial={{
            transactionId: transaction.id,
            accountId: transaction.accountId,
            categoryId: transaction.categoryId,
            date: transaction.date,
            description: transaction.description,
            notes: transaction.notes,
            tags: transaction.tags,
            amountCents: transaction.amountCents,
          }}
        />
      )}
      {!transactionAmountIsSafe ? null : currency ? (
        <SplitEditor
          transactionId={transaction.id}
          amountCents={transaction.amountCents}
          currency={currency}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          initialSplits={splits.map((s) => ({ categoryId: s.categoryId, amountCents: s.amountCents }))}
        />
      ) : (
        <div
          role="alert"
          className="max-w-xl rounded-lg border border-delta-bad/40 bg-delta-bad/5 px-4 py-3 text-sm text-delta-bad"
        >
          This account&apos;s currency needs repair before split amounts can be displayed.{" "}
          <Link href="/accounts" className="underline">
            Repair account currency
          </Link>
          .
        </div>
      )}
    </div>
  );
}
