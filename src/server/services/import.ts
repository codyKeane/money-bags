import { getDb, type Db } from "@/db/client";
import { categories, transactions } from "@/db/schema";
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
}

export interface ImportStatementInput extends ParseStatementOptions {
  accountId: string;
  csvText: string;
}

export async function importStatement(
  input: ImportStatementInput,
  db: Db = getDb(),
): Promise<ImportResult> {
  const { rows, errors } = parseStatementCsv(input.csvText, {
    dateFormat: input.dateFormat,
    columnMap: input.columnMap,
  });
  if (rows.length === 0) return { imported: 0, skipped: [], errors };

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
    },
  }));

  // 6 columns/row keeps each chunk under SQLite's 999 bound-variable limit.
  const CHUNK = 150;
  const insertedHashes = new Set<string>();
  db.transaction((tx) => {
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

  return { imported, skipped, errors };
}
