import { getAccountsWithBalances, getNetWorth } from "@/server/services/accounts";

export async function GET() {
  const [netWorthCents, accounts] = await Promise.all([
    getNetWorth(),
    getAccountsWithBalances(),
  ]);
  return Response.json({
    netWorthCents,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balanceCents: a.balanceCents,
    })),
  });
}
