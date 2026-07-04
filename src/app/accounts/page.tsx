import { AccountsManager } from "@/components/AccountsManager";
import { getAccountsWithBalances } from "@/server/services/accounts";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await getAccountsWithBalances();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Accounts</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Balance = opening balance + all transactions. Set an opening balance
          when an account has history from before your first import.
        </p>
      </div>
      <AccountsManager accounts={accounts} />
    </div>
  );
}
