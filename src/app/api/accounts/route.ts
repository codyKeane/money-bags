import { noStoreJson } from "@/lib/http-response";
import { getAccountsWithBalances } from "@/server/services/accounts";

export const dynamic = "force-dynamic";

export async function GET() {
  return noStoreJson({ accounts: await getAccountsWithBalances() });
}
