import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { getDb, type Db } from "../../db/client";
import { ensureDefaultCategoriesInTransaction } from "../../db/default-categories";
import {
  accounts,
  categories,
  importBatches,
  importDuplicateOverrides,
  transactions,
} from "../../db/schema";
import { categorize, parseKeywords } from "../../lib/categorize";
import { computeImportHashes } from "../../lib/import-hash";
import {
  parseStatementCsv,
  type ColumnMapIssue,
  type DateFormat,
  type ParsedStatementRow,
  type StatementRowError,
} from "../../lib/csv/parse-statement";
import type { AccountType } from "../../lib/account-types";
import { normalizeCurrencyCode } from "../../lib/currency";
import { normalizeCreateAccountInput } from "./accounts";
import {
  invalidWriteInput,
  normalizeFilename,
  normalizeId,
  normalizeTransactionInput,
  type InvalidWriteInput,
} from "./write-validation";

export interface SkippedRow {
  rowNumber: number;
  date: string;
  description: string;
  amountCents: number;
  importHash: string;
  sourceFingerprint: string;
}

interface ImportResultData {
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
  account: ImportedAccountTarget | null;
  sourceFingerprint?: string;
  filename?: string | null;
}

export interface ImportedAccountTarget {
  id: string;
  name: string;
  type: string;
  currency: string;
  created: boolean;
}

export type ImportResult =
  | ({ status: "completed" } & ImportResultData)
  | ({ status: "unknown-account"; message: string } & ImportResultData)
  | ({ status: "account-conflict"; message: string } & ImportResultData)
  | ({ status: "date-format-required"; ambiguousRowNumbers: number[] } & ImportResultData)
  | ({ status: "invalid-column-map"; issues: ColumnMapIssue[] } & ImportResultData)
  | ({ status: "invalid-file" } & ImportResultData)
  | ({ status: "invalid-input"; field: string; message: string } & ImportResultData);

export type ImportAccountTarget =
  | { kind: "existing"; accountId: string }
  | { kind: "by-name"; name: string; type: AccountType; currency: string };

export interface ImportStatementInput {
  account: ImportAccountTarget;
  csvText: string;
  dateFormat?: DateFormat;
  columnMap?: unknown;
  filename?: string; // recorded on the batch for the import-history UI
}

type NormalizedImportAccountTarget =
  | { kind: "existing"; accountId: string }
  | {
      kind: "by-name";
      name: string;
      type: AccountType;
      institution: string | null;
      currency: string;
      openingBalanceCents: number;
    };

function emptyImportData(): ImportResultData {
  return {
    imported: 0,
    skipped: [],
    errors: [],
    warnings: [],
    batchId: null,
    account: null,
    sourceFingerprint: undefined,
    filename: null,
  };
}

function invalidFileResult(errors: StatementRowError[]): ImportResult {
  return { status: "invalid-file", ...emptyImportData(), errors };
}

function normalizeImportTarget(
  target: ImportAccountTarget,
): { ok: true; value: NormalizedImportAccountTarget } | { ok: false; result: InvalidWriteInput } {
  if (!target || typeof target !== "object") {
    return {
      ok: false,
      result: invalidWriteInput("account", "Invalid import account target"),
    };
  }
  if (target.kind === "existing") {
    const accountId = normalizeId(target.accountId);
    return accountId
      ? { ok: true, value: { kind: "existing", accountId } }
      : { ok: false, result: invalidWriteInput("accountId", "Invalid account id") };
  }
  if (target.kind === "by-name") {
    const normalized = normalizeCreateAccountInput({
      name: target.name,
      type: target.type,
      currency: target.currency,
    });
    return normalized.ok
      ? { ok: true, value: { kind: "by-name", ...normalized.value } }
      : normalized;
  }
  return {
    ok: false,
    result: invalidWriteInput("account", "Invalid import account target"),
  };
}

function normalizeParsedRows(
  rows: readonly ParsedStatementRow[],
): { rows: ParsedStatementRow[]; errors: StatementRowError[] } {
  const normalizedRows: ParsedStatementRow[] = [];
  const errors: StatementRowError[] = [];
  for (const row of rows) {
    const normalized = normalizeTransactionInput({
      accountId: "pending-import-account",
      categoryId: null,
      date: row.date,
      description: row.description,
      amountCents: row.amountCents,
    });
    if (!normalized.ok) {
      errors.push({ rowNumber: row.rowNumber, message: normalized.result.message });
    } else {
      normalizedRows.push({
        rowNumber: row.rowNumber,
        date: normalized.value.date,
        description: normalized.value.description,
        amountCents: normalized.value.amountCents,
      });
    }
  }
  return { rows: normalizedRows, errors };
}

type AccountResolution =
  | { ok: true; account: ImportedAccountTarget | null }
  | { ok: false; result: ImportResult };

function resolveImportAccount(
  target: NormalizedImportAccountTarget,
  allowCreate: boolean,
  db: Db,
): AccountResolution {
  if (target.kind === "existing") {
    const account = db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        currency: accounts.currency,
      })
      .from(accounts)
      .where(eq(accounts.id, target.accountId))
      .limit(1)
      .get();
    return account
      ? { ok: true, account: { ...account, created: false } }
      : {
          ok: false,
          result: {
            status: "unknown-account",
            ...emptyImportData(),
            message: "Unknown account",
          },
        };
  }

  const existing = db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(eq(accounts.name, target.name))
    .limit(1)
    .get();
  if (existing) {
    if (
      existing.type !== target.type ||
      normalizeCurrencyCode(existing.currency) !== target.currency
    ) {
      return {
        ok: false,
        result: {
          status: "account-conflict",
          ...emptyImportData(),
          message: "Existing account type or currency does not match the import target.",
        },
      };
    }
    return { ok: true, account: { ...existing, created: false } };
  }
  if (!allowCreate) return { ok: true, account: null };

  const account = db
    .insert(accounts)
    .values({
      name: target.name,
      type: target.type,
      institution: target.institution,
      currency: target.currency,
      openingBalanceCents: target.openingBalanceCents,
    })
    .returning({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency: accounts.currency,
    })
    .get();
  if (!account) throw new Error("Failed to create the import account.");
  return { ok: true, account: { ...account, created: true } };
}

export async function importStatement(
  input: ImportStatementInput,
  db?: Db,
): Promise<ImportResult> {
  if (typeof input.csvText !== "string") {
    return invalidImportResult(invalidWriteInput("csvText", "Invalid CSV text"));
  }
  if (
    input.dateFormat !== undefined &&
    input.dateFormat !== "auto" &&
    input.dateFormat !== "MDY" &&
    input.dateFormat !== "DMY"
  ) {
    return invalidImportResult(invalidWriteInput("dateFormat", "Invalid date format"));
  }
  const filename = input.filename === undefined ? null : normalizeFilename(input.filename);
  if (input.filename !== undefined && !filename) {
    return invalidImportResult(invalidWriteInput("filename", "Invalid import filename"));
  }

  const parsed = parseStatementCsv(input.csvText, {
    dateFormat: input.dateFormat,
    columnMap: input.columnMap,
  });
  if (parsed.status === "date-format-required") {
    return {
      status: parsed.status,
      ...emptyImportData(),
      ambiguousRowNumbers: parsed.ambiguousRowNumbers,
    };
  }
  if (parsed.status === "invalid-column-map") {
    return { status: parsed.status, ...emptyImportData(), issues: parsed.issues };
  }
  if (parsed.status === "invalid-file") return invalidFileResult(parsed.errors);

  const target = normalizeImportTarget(input.account);
  if (!target.ok) return invalidImportResult(target.result);

  const normalizedRows = normalizeParsedRows(parsed.rows);
  if (normalizedRows.errors.length > 0) return invalidFileResult(normalizedRows.errors);
  const rows = normalizedRows.rows;
  const sourceFingerprint = sha256(input.csvText);
  const database = db ?? getDb({ installDefaults: false });

  // All hashes within one file are unique (occurrence indexing), so the set of
  // hashes RETURNING reports as inserted cleanly partitions imported vs.
  // skipped — preserving the skipped-row detail contract while inserting in
  // batches instead of one re-prepared INSERT per row (P7).
  // Every inserted row is stamped with this batch so the whole import can be
  // undone later. The batch row is written first (inside the txn) to satisfy
  // the transactions.batch_id foreign key, then finalized once counts are known.
  return database.transaction((tx) => {
    const resolution = resolveImportAccount(target.value, rows.length > 0, tx);
    if (!resolution.ok) return resolution.result;
    if (rows.length === 0) {
      return { status: "completed", ...emptyImportData(), account: resolution.account };
    }
    if (!resolution.account) throw new Error("Ready import did not resolve an account.");
    const accountId = resolution.account.id;

    // On a connection acquired without startup bootstrap, defaults join the
    // same rollback boundary as account creation, batch creation, and rows.
    ensureDefaultCategoriesInTransaction(tx);
    const categoryRows = tx.select().from(categories).all();
    const matchers = categoryRows.map((category) => ({
      id: category.id,
      name: category.name,
      keywords: parseKeywords(category.keywords),
    }));
    const batchId = crypto.randomUUID();
    const hashes = computeImportHashes(accountId, rows);
    const prepared = rows.map((row, index) => {
      const normalized = normalizeTransactionInput({
        accountId,
        categoryId: categorize(row.description, matchers),
        date: row.date,
        description: row.description,
        amountCents: row.amountCents,
      });
      if (!normalized.ok) {
        throw new Error("Pure import validation diverged from transaction validation.");
      }
      const hash = hashes[index];
      if (!hash) throw new Error("Missing import hash for a validated row.");
      return {
        row,
        hash,
        values: { ...normalized.value, importHash: hash, batchId },
      };
    });

    // 7 columns/row keeps each chunk under SQLite's 999 bound-variable limit.
    const CHUNK = 128;
    const insertedHashes = new Set<string>();
    tx.insert(importBatches)
      .values({
        id: batchId,
        accountId,
        filename,
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
          importHash: hash,
          sourceFingerprint,
        });
      }
    }
    return {
      status: "completed",
      imported,
      skipped,
      errors: [],
      warnings: [],
      batchId: imported > 0 ? batchId : null,
      account: resolution.account,
      sourceFingerprint,
      filename,
    };
  }, { behavior: "immediate" });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export interface DuplicateImportOverrideInput {
  accountId: string;
  sourceFingerprint: string;
  sourceRowNumber: number;
  importHash: string;
  date: string;
  description: string;
  amountCents: number;
  filename?: string | null;
}

export type DuplicateImportOverrideResult =
  | { status: "overridden"; batchId: string; transactionId: string }
  | { status: "already-overridden" }
  | { status: "source-not-found" }
  | { status: "invalid-input"; field: string; message: string };

// Explicit duplicate overrides are deliberately separate from the frozen
// import-hash contract: the new row has no importHash, while this provenance
// row records exactly which source file/row the user chose to keep.
export async function overrideDuplicateImport(
  input: DuplicateImportOverrideInput,
  db: Db = getDb(),
): Promise<DuplicateImportOverrideResult> {
  const accountId = normalizeId(input.accountId);
  const sourceFingerprint = input.sourceFingerprint.trim().toLowerCase();
  const importHash = input.importHash.trim().toLowerCase();
  const description = typeof input.description === "string" ? input.description : "";
  const normalized = normalizeTransactionInput({
    accountId: accountId ?? "",
    categoryId: null,
    date: input.date,
    description,
    amountCents: input.amountCents,
  });
  const filename = input.filename == null ? null : normalizeFilename(input.filename);
  if (!accountId) return { status: "invalid-input", field: "accountId", message: "Invalid account id" };
  if (!isSha256(sourceFingerprint)) {
    return { status: "invalid-input", field: "sourceFingerprint", message: "Invalid source fingerprint" };
  }
  if (!isSha256(importHash)) {
    return { status: "invalid-input", field: "importHash", message: "Invalid import hash" };
  }
  if (!Number.isSafeInteger(input.sourceRowNumber) || input.sourceRowNumber < 1) {
    return { status: "invalid-input", field: "sourceRowNumber", message: "Invalid source row number" };
  }
  if (!normalized.ok) return normalized.result;
  if (input.filename !== undefined && input.filename !== null && !filename) {
    return { status: "invalid-input", field: "filename", message: "Invalid import filename" };
  }

  return db.transaction((tx) => {
    const source = tx
      .select({
        id: transactions.id,
        date: transactions.date,
        description: transactions.description,
        amountCents: transactions.amountCents,
      })
      .from(transactions)
      .where(
        and(eq(transactions.accountId, accountId), eq(transactions.importHash, importHash)),
      )
      .limit(1)
      .get();
    if (!source) return { status: "source-not-found" };
    if (
      source.date !== normalized.value.date ||
      source.description !== normalized.value.description ||
      source.amountCents !== normalized.value.amountCents
    ) {
      return {
        status: "invalid-input",
        field: "sourceRowNumber",
        message: "Duplicate override data does not match the existing imported row.",
      };
    }

    const existingOverride = tx
      .select({ id: importDuplicateOverrides.id })
      .from(importDuplicateOverrides)
      .where(
        and(
          eq(importDuplicateOverrides.accountId, accountId),
          eq(importDuplicateOverrides.sourceFingerprint, sourceFingerprint),
          eq(importDuplicateOverrides.sourceRowNumber, input.sourceRowNumber),
        ),
      )
      .limit(1)
      .get();
    if (existingOverride) return { status: "already-overridden" };

    ensureDefaultCategoriesInTransaction(tx);
    const categoryRows = tx.select().from(categories).all();
    const categoryId = categorize(source.description, categoryRows.map((category) => ({
      id: category.id,
      name: category.name,
      keywords: parseKeywords(category.keywords),
    })));
    const batchId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    tx.insert(importBatches).values({
      id: batchId,
      accountId,
      filename,
      importedCount: 1,
      skippedCount: 1,
    }).run();
    tx.insert(transactions).values({
      id: transactionId,
      accountId,
      categoryId,
      date: source.date,
      description: source.description,
      amountCents: source.amountCents,
      notes: normalized.value.notes,
      tagsJson: normalized.value.tagsJson,
      importHash: null,
      batchId,
      merchant: normalized.value.merchant,
      cleared: normalized.value.cleared,
      excludeFromSpending: normalized.value.excludeFromSpending,
    }).run();
    tx.insert(importDuplicateOverrides).values({
      id: crypto.randomUUID(),
      batchId,
      transactionId,
      accountId,
      sourceFingerprint,
      sourceRowNumber: input.sourceRowNumber,
      importHash,
    }).run();
    return { status: "overridden", batchId, transactionId };
  }, { behavior: "immediate" });
}

function invalidImportResult(invalid: InvalidWriteInput): ImportResult {
  return {
    status: invalid.status,
    imported: 0,
    skipped: [],
    errors: [],
    warnings: [],
    batchId: null,
    account: null,
    field: invalid.field,
    message: invalid.message,
  };
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
