import { noStoreJson } from "@/lib/http-response";
import { buildNetWorthOverview, getAccountsWithBalances } from "@/server/services/accounts";

export const dynamic = "force-dynamic";

export async function GET() {
  const accounts = await getAccountsWithBalances();
  const overview = buildNetWorthOverview(accounts);
  return noStoreJson({
    netWorthCents: overview.netWorthCents,
    currencyState: overview.currencyState,
    aggregateState: overview.aggregateState,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balanceCents: a.balanceCents,
      balanceState: a.balanceState,
      rawCurrency: a.rawCurrency,
      currency: a.currency,
      normalizedCurrency: a.normalizedCurrency,
      currencyState: a.currencyState,
    })),
  });
}
