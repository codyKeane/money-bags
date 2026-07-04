import { TransactionTable } from "@/components/TransactionTable";
import {
  getAllCategories,
  getRecentTransactions,
} from "@/server/services/transactions";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const [transactions, categories] = await Promise.all([
    getRecentTransactions(100),
    getAllCategories(),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Transactions</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Latest {transactions.length} transactions. Change a category to
          recategorize.
        </p>
      </div>
      <TransactionTable
        transactions={transactions}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
