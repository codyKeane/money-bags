import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";

// Cheap liveness probe for uptime monitoring — verifies the DB answers a
// trivial query without doing aggregate work or leaking balances (unlike
// /api/accounts). curl 127.0.0.1:3100/api/health
export function GET() {
  try {
    getDb().get(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
