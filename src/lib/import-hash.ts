import { createHash } from "node:crypto";

// DEDUPE CONTRACT — FROZEN once real data exists (see CLAUDE.md).
// Hash input: accountId|date|amountCents|normalizedDesc|occurrenceIndex.
// Changing normalization or field order orphans every stored importHash.

export function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface HashableRow {
  date: string; // YYYY-MM-DD
  amountCents: number;
  description: string;
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// Occurrence indexes are assigned in row order within one file/batch, so
// re-hashing the same file always yields identical hashes (idempotent
// re-import) while two identical rows in one file get distinct hashes.
export function computeImportHashes(
  accountId: string,
  rows: readonly HashableRow[],
): string[] {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const normalized = normalizeDescription(row.description);
    const key = `${row.date}|${row.amountCents}|${normalized}`;
    const index = occurrences.get(key) ?? 0;
    occurrences.set(key, index + 1);
    return sha256(
      `${accountId}|${row.date}|${row.amountCents}|${normalized}|${index}`,
    );
  });
}
