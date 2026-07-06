import { type NextRequest } from "next/server";
import { transactionsToCsv } from "@/lib/csv/export";
import {
  getTransactionsForExport,
  parseTransactionQuery,
} from "@/server/services/transactions";

// GET /api/export?q=&account=&category=&month=&from=&to= — the current filtered
// transaction view as a CSV download (F2). Same query parsing as the list page,
// so the file contains exactly the rows on screen (unpaged).
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const query = parseTransactionQuery((key) => sp.get(key));
  const rows = await getTransactionsForExport(query);
  const csv = transactionsToCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
