import { notFound } from "next/navigation";
import { TransactionForm } from "@/components/TransactionForm";
import { getAccountOptions } from "@/server/services/accounts";
import { getAllCategories } from "@/server/services/categories";
import { getTransactionById } from "@/server/services/transactions";

export const dynamic = "force-dynamic";

export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const transaction = await getTransactionById(id);
  if (!transaction) notFound();

  const [accounts, categories] = await Promise.all([
    getAccountOptions(),
    getAllCategories(),
  ]);

  return (
    <div className="flex flex-col gap-4">
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
    </div>
  );
}
