import { type NextRequest } from "next/server";
import { noStoreJson } from "@/lib/http-response";
import { isValidMonth } from "@/lib/month";
import { getNetWorthOverview } from "@/server/services/accounts";
import { getMonthlySpendingOverview } from "@/server/services/summary";
import { getLatestTransactionMonth } from "@/server/services/transactions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let month = request.nextUrl.searchParams.get("month");
  if (month !== null && !isValidMonth(month)) {
    return noStoreJson({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  const overview = await getNetWorthOverview();
  month ??= await getLatestTransactionMonth();
  if (!month) {
    return noStoreJson({
      month: null,
      currencyState: overview.currencyState,
      aggregateState: overview.aggregateState,
      summary: null,
      byCategory: [],
    });
  }
  return noStoreJson({ month, ...(await getMonthlySpendingOverview(month, overview)) });
}
