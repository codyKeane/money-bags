import { type NextRequest } from "next/server";
import { type TransactionExportFormat } from "@/lib/csv/transaction-export";
import { noStoreJson } from "@/lib/http-response";
import { prepareTransactionExport } from "@/server/services/transaction-export";
import { parseTransactionQuery } from "@/server/services/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return noStoreJson(body, { status });
}

function parseFormat(value: string | null): TransactionExportFormat | null {
  if (value === null || value === "legacy") return "legacy";
  if (value === "detailed") return "detailed";
  return null;
}

// GET /api/export?q=&account=&category=&month=&from=&to=&format=legacy|detailed
// streams the complete filtered parent-ledger view. Legacy retains the original
// five-column contract; detailed is currency-explicit and split-aware.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const format = parseFormat(sp.get("format"));
  if (!format) {
    return json(
      { error: "invalid-format", message: "format must be legacy or detailed." },
      400,
    );
  }

  try {
    const query = parseTransactionQuery((key) => sp.get(key));
    const result = await prepareTransactionExport(query, format);
    if (result.status === "mixed-currency") {
      return json(
        {
          error: result.status,
          message:
            "Legacy export requires one currency. Use detailed format or filter to one account.",
        },
        409,
      );
    }
    if (result.status === "invalid-currency") {
      return json(
        {
          error: result.status,
          accounts: result.accounts,
          message: "Repair the listed account currencies before exporting.",
        },
        409,
      );
    }
    if (result.status === "unsafe-data") {
      return json(
        {
          error: result.status,
          message: "The selection contains unsafe historical data and cannot be exported.",
        },
        409,
      );
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(result.stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="transactions-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    console.error("transaction export route failed unexpectedly");
    return json(
      { error: "internal-error", message: "Transaction export failed unexpectedly." },
      500,
    );
  }
}
