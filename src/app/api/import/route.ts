import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { importStatement } from "@/server/services/import";

const MAX_BYTES = 5 * 1024 * 1024;

const FieldsSchema = z.object({
  accountId: z.string().min(1),
  dateFormat: z.enum(["auto", "MDY", "DMY"]).default("auto"),
});

const CANONICAL_COLUMNS = ["date", "description", "amount", "debit", "credit"] as const;
type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number];

// The optional column-mapping override arrives as a JSON string (canonical
// field -> header name). Silently ignore anything malformed or off-list — a bad
// map just falls back to automatic header detection (F3).
function parseColumnMap(raw: FormDataEntryValue | null): Partial<Record<CanonicalColumn, string>> | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!obj || typeof obj !== "object") return undefined;
  const map: Partial<Record<CanonicalColumn, string>> = {};
  for (const key of CANONICAL_COLUMNS) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) map[key] = value.trim();
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

// The import upload goes through this route handler (not a Server Action) —
// Server Actions cap request bodies at 1 MB by default; here we enforce our
// own 5 MB / CSV-only policy. Every failure returns JSON `{ error }` so the
// client can always surface a message (F4).
export async function POST(request: Request) {
  try {
    // Reject oversized uploads before buffering the whole body when the client
    // declares its length (F4). file.size below is the authoritative check for
    // clients that omit or understate Content-Length.
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      return Response.json({ error: "File exceeds the 5 MB cap" }, { status: 413 });
    }

    const formData = await request.formData();
    const parsed = FieldsSchema.safeParse({
      accountId: formData.get("accountId") ?? undefined,
      dateFormat: formData.get("dateFormat") ?? undefined,
    });
    if (!parsed.success) {
      return Response.json({ error: "accountId is required" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: "File exceeds the 5 MB cap" }, { status: 413 });
    }
    const isCsv =
      file.name.toLowerCase().endsWith(".csv") ||
      file.type === "text/csv" ||
      file.type === "text/plain";
    if (!isCsv) {
      return Response.json({ error: "Only CSV files are accepted" }, { status: 415 });
    }

    const db = getDb();
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, parsed.data.accountId))
      .limit(1);
    if (!account) {
      return Response.json({ error: "Unknown account" }, { status: 404 });
    }

    const result = await importStatement({
      accountId: account.id,
      csvText: await file.text(),
      dateFormat: parsed.data.dateFormat,
      columnMap: parseColumnMap(formData.get("columnMap")),
    });

    revalidatePath("/");
    revalidatePath("/transactions");
    return Response.json(result);
  } catch (err) {
    // Malformed multipart, encoding failures, unexpected DB errors — never leak
    // an HTML stack to the JSON-expecting client.
    console.error("import route failed:", err);
    return Response.json({ error: "Import failed unexpectedly." }, { status: 500 });
  }
}
