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

// The import upload goes through this route handler (not a Server Action) —
// Server Actions cap request bodies at 1 MB by default; here we enforce our
// own 5 MB / CSV-only policy.
export async function POST(request: Request) {
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
  });

  revalidatePath("/");
  revalidatePath("/transactions");
  return Response.json(result);
}
