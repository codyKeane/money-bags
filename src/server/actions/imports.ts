"use server";

import { undoImport } from "@/server/services/import";
import { revalidateAll, type ActionResult } from "./shared";

// Undo a whole import: delete every transaction the batch added and the batch
// record itself. Destructive, so it re-verifies the batch exists server-side
// (the client confirm is not trusted) and reports a clear error if it's gone.
export async function undoImportAction(batchId: string): Promise<ActionResult> {
  if (!batchId) return { ok: false, error: "Missing import id" };
  const result = await undoImport(batchId);
  if (!result) return { ok: false, error: "Import not found — it may already be undone." };
  revalidateAll();
  return { ok: true };
}
