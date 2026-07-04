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

  const skipped: SkippedRow[] = [];
  let imported = 0;
  // better-sqlite3 transactions are synchronous; the whole batch commits or
  // rolls back together, and ON CONFLICT DO NOTHING classifies duplicates.
  db.transaction((tx) => {
    rows.forEach((row, i) => {
      const result = tx
        .insert(transactions)
        .values({
          date: row.date,
          description: row.description,
          amountCents: row.amountCents,
          accountId: input.accountId,
          categoryId: categorize(row.description, matchers),
          importHash: hashes[i],
        })
        .onConflictDoNothing({ target: transactions.importHash })
        .run();
      if (result.changes > 0) {
        imported++;
      } else {
        skipped.push({
          rowNumber: row.rowNumber,
          date: row.date,
          description: row.description,
          amountCents: row.amountCents,
        });
      }
    });
  });

  return { imported, skipped, errors };
}
