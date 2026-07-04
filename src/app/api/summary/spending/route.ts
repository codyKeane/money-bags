import { type NextRequest } from "next/server";
import { isValidMonth } from "@/lib/month";
import { getMonthlySpendingByCategory, getMonthlySummary } from "@/server/services/summary";
import { getLatestTransactionMonth } from "@/server/services/transactions";

export async function GET(request: NextRequest) {
  let month = request.nextUrl.searchParams.get("month");
  if (month !== null && !isValidMonth(month)) {
    return Response.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  month ??= await getLatestTransactionMonth();
  if (!month) {
    return Response.json({ month: null, summary: null, byCategory: [] });
  }
  const [summary, byCategory] = await Promise.all([
    getMonthlySummary(month),
    getMonthlySpendingByCategory(month),
  ]);
  return Response.json({ month, summary, byCategory });
}
