import { desc, eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { accounts, categories, importBatches, transactions } from "@/db/schema";
import { categorize, parseKeywords } from "@/lib/categorize";
import { computeImportHashes } from "@/lib/import-hash";
import {
  parseStatementCsv,
  type ParseStatementOptions,
  type StatementRowError,
} from "@/lib/csv/parse-statement";

export interface SkippedRow {
  rowNumber: number;
  date: string;
  description: string;
  amountCents: number;
}

export interface ImportResult {
  imported: number;
  // Skipped rows are reported in detail: a "duplicate" here can also be a
  // legitimately identical transaction arriving in a second file (see
  // CLAUDE.md dedupe contract) — the user needs to be able to spot that.
  skipped: SkippedRow[];
  errors: StatementRowError[];
  warnings: string[]; // file-level advisories from the parser (F3)
  // The batch this import recorded, or null when it inserted nothing (all
  // duplicates / empty file) — nothing to undo, so no batch is created.
  batchId: string | null;
}

export interface ImportStatementInput extends ParseStatementOptions {
  accountId: string;
  csvText: string;
  filename?: string; // recorded on the batch for the import-history UI
}

export async function importStatement(
  input: ImportStatementInput,
  db: Db = getDb(),
): Promise<ImportResult> {
  const { rows, errors, warnings } = parseStatementCsv(input.csvText, {
    dateFormat: input.dateFormat,
    columnMap: input.columnMap,
  });
  if (rows.length === 0)
    return { imported: 0, skipped: [], errors, warnings, batchId: null };

  const categoryRows = await db.select().from(categories);
  const matchers = categoryRows.map((c) => ({
    id: c.id,
    name: c.name,
    keywords: parseKeywords(c.keywords),
  }));
  const hashes = computeImportHashes(input.accountId, rows);

  // All hashes within one file are unique (occurrence indexing), so the set of
  // hashes RETURNING reports as inserted cleanly partitions imported vs.
  // skipped — preserving the skipped-row detail contract while inserting in
  // batches instead of one re-prepared INSERT per row (P7).
  // Every inserted row is stamped with this batch so the whole import can be
  // undone later. The batch row is written first (inside the txn) to satisfy
  // the transactions.batch_id foreign key, then finalized once counts are known.
  const batchId = crypto.randomUUID();
  const prepared = rows.map((row, i) => ({
    row,
    hash: hashes[i] ?? "",
    values: {
      date: row.date,
      description: row.description,
      amountCents: row.amountCents,
      accountId: input.accountId,
      categoryId: categorize(row.description, matchers),
      importHash: hashes[i] ?? "",
      batchId,
    },
  }));

  // 7 columns/row keeps each chunk under SQLite's 999 bound-variable limit.
  const CHUNK = 128;
  const insertedHashes = new Set<string>();
  db.transaction((tx) => {
    tx.insert(importBatches)
      .values({
        id: batchId,
        accountId: input.accountId,
        filename: input.filename ?? null,
        importedCount: 0,
        skippedCount: 0,
      })
      .run();
    for (let i = 0; i < prepared.length; i += CHUNK) {
      const slice = prepared.slice(i, i + CHUNK);
      const returned = tx
        .insert(transactions)
        .values(slice.map((p) => p.values))
        .onConflictDoNothing({ target: transactions.importHash })
        .returning({ importHash: transactions.importHash })
        .all();
      for (const r of returned) {
        if (r.importHash) insertedHashes.add(r.importHash);
      }
    }
    const importedCount = insertedHashes.size;
    if (importedCount === 0) {
      // Nothing inserted — drop the placeholder so history shows only real imports.
      tx.delete(importBatches).where(eq(importBatches.id, batchId)).run();
    } else {
      tx.update(importBatches)
        .set({ importedCount, skippedCount: prepared.length - importedCount })
        .where(eq(importBatches.id, batchId))
        .run();
    }
  });

  const skipped: SkippedRow[] = [];
  let imported = 0;
  for (const { row, hash } of prepared) {
    if (insertedHashes.has(hash)) {
      imported++;
    } else {
      skipped.push({
        rowNumber: row.rowNumber,
        date: row.date,
        description: row.description,
        amountCents: row.amountCents,
      });
    }
  }

  return { imported, skipped, errors, warnings, batchId: imported > 0 ? batchId : null };
}

// ---------- import history + undo ----------

export interface ImportBatchListItem {
  id: string;
  accountId: string;
  accountName: string;
  filename: string | null;
  importedCount: number;
  skippedCount: number;
  createdAt: number;
}

// Most-recent imports first, for the import-history list on /import.
export async function getRecentImportBatches(
  limit = 20,
  db: Db = getDb(),
): Promise<ImportBatchListItem[]> {
  return db
    .select({
      id: importBatches.id,
      accountId: importBatches.accountId,
      accountName: accounts.name,
      filename: importBatches.filename,
      importedCount: importBatches.importedCount,
      skippedCount: importBatches.skippedCount,
      createdAt: importBatches.createdAt,
    })
    .from(importBatches)
    .innerJoin(accounts, eq(importBatches.accountId, accounts.id))
    .orderBy(desc(importBatches.createdAt))
    .limit(limit);
}

export interface UndoImportResult {
  deletedCount: number;
  filename: string | null;
}

// Delete every transaction the batch inserted, then the batch row itself — an
// explicit two-step delete (batch_id is set-null, not cascade) so the removal
// is deliberate and its row count is observable. Returns null if the batch is
// gone (already undone / bad id). Rows the user later re-categorized or edited
// still belong to the batch and are removed too.
export async function undoImport(
  batchId: string,
  db: Db = getDb(),
): Promise<UndoImportResult | null> {
  return db.transaction((tx) => {
    const batch = tx
      .select({ filename: importBatches.filename })
      .from(importBatches)
      .where(eq(importBatches.id, batchId))
      .get();
    if (!batch) return null;
    const deleted = tx
      .delete(transactions)
      .where(eq(transactions.batchId, batchId))
      .returning({ id: transactions.id })
      .all();
    tx.delete(importBatches).where(eq(importBatches.id, batchId)).run();
    return { deletedCount: deleted.length, filename: batch.filename };
  });
}
