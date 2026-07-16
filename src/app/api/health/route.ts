import { noStoreJson } from "@/lib/http-response";
import { checkDatabaseHealth } from "@/server/services/health";

export const dynamic = "force-dynamic";

// Cheap liveness probe for uptime monitoring — verifies the DB answers a
// trivial query without doing aggregate work or leaking balances (unlike
// /api/accounts). curl 127.0.0.1:3100/api/health
export function GET() {
  try {
    checkDatabaseHealth();
    return noStoreJson({ ok: true });
  } catch {
    return noStoreJson({ ok: false }, { status: 500 });
  }
}
