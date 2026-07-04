import { type NextRequest } from "next/server";
import { z } from "zod";
import { getRecentTransactions } from "@/server/services/transactions";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(request: NextRequest) {
  const parsed = QuerySchema.safeParse({
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "limit must be an integer 1-500" }, { status: 400 });
  }
  return Response.json({
    transactions: await getRecentTransactions(parsed.data.limit),
  });
}
