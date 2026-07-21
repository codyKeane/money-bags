"use server";

import { z } from "zod";
import { revalidateAfterMutation } from "@/server/revalidation";
import {
  overrideDuplicateImport,
  undoImport,
  type DuplicateImportOverrideInput,
} from "@/server/services/import";
import { assertTrustedActionOrigin } from "@/server/security/trusted-origin";
import { isValidIsoDate } from "@/lib/month";
import { type ActionResult } from "./shared";

// Undo a whole import: delete every transaction the batch added and the batch
// record itself. Destructive, so it re-verifies the batch exists server-side
// (the client confirm is not trusted) and reports a clear error if it's gone.
export async function undoImportAction(batchId: string): Promise<ActionResult> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  if (!batchId) return { ok: false, error: "Missing import id" };
  const result = await undoImport(batchId);
  if (!result) return { ok: false, error: "Import not found — it may already be undone." };
  revalidateAfterMutation();
  return { ok: true };
}

const DuplicateOverrideSchema = z.object({
  accountId: z.string().min(1),
  sourceFingerprint: z.string().length(64),
  sourceRowNumber: z.number().int().positive(),
  importHash: z.string().length(64),
  date: z.string().refine(isValidIsoDate),
  description: z.string().min(1).max(500),
  amountCents: z.number().safe().int(),
  filename: z.string().max(255).nullable().optional(),
});

// The client may request this only after the import UI displayed a duplicate.
// The service still proves the frozen hash belongs to the selected account and
// records the source row in a unique provenance table before committing.
export async function overrideDuplicateImportAction(
  input: DuplicateImportOverrideInput,
): Promise<ActionResult> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  const parsed = DuplicateOverrideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid duplicate override" };
  const result = await overrideDuplicateImport(parsed.data);
  if (result.status === "already-overridden") {
    return { ok: false, error: "This source row was already imported as a separate transaction." };
  }
  if (result.status === "source-not-found") {
    return { ok: false, error: "The original duplicate source row is no longer available." };
  }
  if (result.status === "invalid-input") return { ok: false, error: result.message };
  revalidateAfterMutation();
  return { ok: true };
}
