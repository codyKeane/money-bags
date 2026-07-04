import { getAccountsWithBalances } from "@/server/services/accounts";

export async function GET() {
  return Response.json({ accounts: await getAccountsWithBalances() });
}
