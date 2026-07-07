import Link from "next/link";
import { notFound } from "next/navigation";
import { SplitEditor } from "@/components/SplitEditor";
import { TransactionForm } from "@/components/TransactionForm";
import { getAccountById, getAccountOptions } from "@/server/services/accounts";
import { getAllCategories } from "@/server/services/categories";
import { getSplitsForTransaction, getTransactionById } from "@/server/services/transactions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Edit transaction" };

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

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/transactions"
        className="inline-flex min-h-11 items-center self-start text-sm text-ink-2 underline underline-offset-2"
      >
        ← Back to transactions
      </Link>
      <h1 className="text-lg font-semibold">Edit transaction</h1>
      <TransactionForm
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        initial={{
          transactionId: transaction.id,
          accountId: transaction.accountId,
          categoryId: transaction.categoryId,
          date: transaction.date,
          description: transaction.description,
          amountCents: transaction.amountCents,
        }}
      />
      <SplitEditor
        transactionId={transaction.id}
        amountCents={transaction.amountCents}
        currency={account?.currency ?? "USD"}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        initialSplits={splits.map((s) => ({ categoryId: s.categoryId, amountCents: s.amountCents }))}
      />
    </div>
  );
}
