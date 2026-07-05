import { getAccountsWithBalances, sumNetWorth } from "@/server/services/accounts";

export async function GET() {
  // one aggregate, summed in JS (P4) — was two identical queries
  const accounts = await getAccountsWithBalances();
  return Response.json({
    netWorthCents: sumNetWorth(accounts),
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balanceCents: a.balanceCents,
    })),
  });
}
