import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import * as schema from "@/db/schema";
import { accounts, categories, transactions, transactionSplits } from "@/db/schema";
import {
  preflightDatabaseOpen,
  preflightExplicitDatabaseOpen,
} from "@/db/preflight";
import { enforcePrivateProcessUmask } from "@/db/private-process";
import { deriveCurrencyState, normalizeCurrencyCode } from "@/lib/currency";
import {
  ANNOTATED_EXPORT_HEADER,
  DETAILED_EXPORT_HEADER,
  LEGACY_EXPORT_HEADER,
  serializeExportRow,
  type TransactionExportFormat,
  type TransactionExportSplitDetail,
} from "@/lib/csv/transaction-export";
import { transactionHasSplits } from "./active-category";
import { buildTransactionWhere, type TransactionQuery } from "./transactions";
import { parseStoredTransactionTags } from "./write-validation";

export const EXPORT_PARENT_CHUNK_SIZE = 500;

export type ExportQueryKind = "currency" | "parents" | "splits";

export interface PrepareTransactionExportOptions {
  databasePath?: string;
  chunkSize?: number;
  onQuery?: (kind: ExportQueryKind) => void;
}

export type PrepareTransactionExportResult =
  | {
      status: "ready";
      stream: ReadableStream<Uint8Array>;
      isClosed: () => boolean;
    }
  | { status: "mixed-currency" }
  | { status: "invalid-currency"; accounts: Array<{ id: string; name: string }> }
  | { status: "unsafe-data" };

interface ParentCursor {
  date: string;
  createdAt: number;
  id: string;
}

const unsafeIntegerPredicate = (column: SQLWrapper): SQL => sql`(
  typeof(${column}) <> 'integer'
  or ${column} < ${Number.MIN_SAFE_INTEGER}
  or ${column} > ${Number.MAX_SAFE_INTEGER}
)`;

function cursorPredicate(cursor: ParentCursor | null): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    gt(transactions.date, cursor.date),
    and(eq(transactions.date, cursor.date), gt(transactions.createdAt, cursor.createdAt)),
    and(
      eq(transactions.date, cursor.date),
      eq(transactions.createdAt, cursor.createdAt),
      gt(transactions.id, cursor.id),
    ),
  );
}

function combineFailure(primary: unknown, cleanup: unknown): unknown {
  return new AggregateError(
    [primary, cleanup],
    "Transaction export failed and its database snapshot could not be cleaned up.",
  );
}

export async function prepareTransactionExport(
  query: TransactionQuery,
  format: TransactionExportFormat,
  options: PrepareTransactionExportOptions = {},
): Promise<PrepareTransactionExportResult> {
  const chunkSize = options.chunkSize ?? EXPORT_PARENT_CHUNK_SIZE;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > EXPORT_PARENT_CHUNK_SIZE) {
    throw new RangeError(`Export chunk size must be between 1 and ${EXPORT_PARENT_CHUNK_SIZE}.`);
  }

  const databasePath = options.databasePath
    ? preflightExplicitDatabaseOpen(options.databasePath).databasePath
    : preflightDatabaseOpen().databasePath;
  enforcePrivateProcessUmask();
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });
  const db = drizzle(sqlite, { schema });
  let closed = false;

  const closeAfter = (mode: "commit" | "rollback"): void => {
    if (closed) return;
    const errors: unknown[] = [];
    try {
      if (sqlite.inTransaction) sqlite.exec(mode === "commit" ? "COMMIT" : "ROLLBACK");
    } catch (error) {
      errors.push(error);
      if (mode === "commit") {
        try {
          if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
        } catch (rollbackError) {
          errors.push(rollbackError);
        }
      }
    }
    try {
      sqlite.close();
    } catch (error) {
      errors.push(error);
    } finally {
      closed = true;
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "Transaction export snapshot cleanup failed.");
    }
  };

  try {
    sqlite.exec("BEGIN DEFERRED");
    const selectedWhere = buildTransactionWhere(query);

    options.onQuery?.("currency");
    const selectedAccounts = db
      .selectDistinct({
        id: accounts.id,
        name: accounts.name,
        rawCurrency: accounts.currency,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(selectedWhere)
      .all();
    const currencyState = deriveCurrencyState(selectedAccounts);

    if (currencyState.kind === "invalid") {
      closeAfter("rollback");
      return { status: "invalid-currency", accounts: currencyState.accounts };
    }
    if (format === "legacy" && currencyState.kind === "mixed") {
      closeAfter("rollback");
      return { status: "mixed-currency" };
    }

    const unsafeParent = db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(selectedWhere, unsafeIntegerPredicate(transactions.amountCents)))
      .limit(1)
      .get();
    const unsafeCursor = db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(selectedWhere, unsafeIntegerPredicate(transactions.createdAt)))
      .limit(1)
      .get();
    const unsafeSplit = db
      .select({ id: transactionSplits.id })
      .from(transactionSplits)
      .innerJoin(transactions, eq(transactionSplits.transactionId, transactions.id))
      .where(and(selectedWhere, unsafeIntegerPredicate(transactionSplits.amountCents)))
      .limit(1)
      .get();
    if (unsafeParent || unsafeCursor || unsafeSplit) {
      closeAfter("rollback");
      return { status: "unsafe-data" };
    }

    const currencyByAccountId = new Map(
      selectedAccounts.map((account) => {
        const currency = normalizeCurrencyCode(account.rawCurrency);
        if (!currency) throw new Error("Validated export currency became invalid.");
        return [account.id, currency] as const;
      }),
    );
    const encoder = new TextEncoder();
    const header =
      format === "legacy"
        ? LEGACY_EXPORT_HEADER
        : format === "detailed"
          ? DETAILED_EXPORT_HEADER
          : ANNOTATED_EXPORT_HEADER;
    let cursor: ParentCursor | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${header}\r\n`));
      },
      pull(controller) {
        if (closed) {
          controller.close();
          return;
        }

        try {
          options.onQuery?.("parents");
          const parents = db
            .select({
              id: transactions.id,
              date: transactions.date,
              createdAt: transactions.createdAt,
              description: transactions.description,
              notes: transactions.notes,
              tagsJson: transactions.tagsJson,
              amountCents: transactions.amountCents,
              accountId: transactions.accountId,
              accountName: accounts.name,
              categoryName: categories.name,
              isSplit: transactionHasSplits(),
            })
            .from(transactions)
            .innerJoin(accounts, eq(transactions.accountId, accounts.id))
            .leftJoin(categories, eq(transactions.categoryId, categories.id))
            .where(and(selectedWhere, cursorPredicate(cursor)))
            .orderBy(asc(transactions.date), asc(transactions.createdAt), asc(transactions.id))
            .limit(chunkSize)
            .all();

          if (parents.length === 0) {
            closeAfter("commit");
            controller.close();
            return;
          }

          options.onQuery?.("splits");
          const splitRows = db
            .select({
              transactionId: transactionSplits.transactionId,
              category: categories.name,
              amountCents: transactionSplits.amountCents,
            })
            .from(transactionSplits)
            .leftJoin(categories, eq(transactionSplits.categoryId, categories.id))
            .where(inArray(transactionSplits.transactionId, parents.map((parent) => parent.id)))
            .all();
          const detailsByTransactionId = new Map<string, TransactionExportSplitDetail[]>();
          for (const split of splitRows) {
            const details = detailsByTransactionId.get(split.transactionId) ?? [];
            details.push({ category: split.category, amountCents: split.amountCents });
            detailsByTransactionId.set(split.transactionId, details);
          }

          const records = parents.map((parent) => {
            const currency = currencyByAccountId.get(parent.accountId);
            if (!currency) throw new Error("Export row account was absent from currency preflight.");
            return serializeExportRow(
              {
                date: parent.date,
                description: parent.description,
                notes: parent.notes,
                tags: parseStoredTransactionTags(parent.tagsJson),
                amountCents: parent.amountCents,
                currency,
                accountName: parent.accountName,
                categoryName: parent.categoryName,
                isSplit: Boolean(parent.isSplit),
                splitDetails: detailsByTransactionId.get(parent.id) ?? [],
              },
              format,
            );
          });
          const last = parents.at(-1);
          if (!last) throw new Error("Non-empty export page had no keyset cursor.");
          cursor = { date: last.date, createdAt: last.createdAt, id: last.id };
          controller.enqueue(encoder.encode(`${records.join("\r\n")}\r\n`));

          if (parents.length < chunkSize) {
            closeAfter("commit");
            controller.close();
          }
        } catch (error) {
          let failure = error;
          try {
            closeAfter("rollback");
          } catch (cleanupError) {
            failure = combineFailure(error, cleanupError);
          }
          controller.error(failure);
        }
      },
      cancel() {
        closeAfter("rollback");
      },
    });

    return { status: "ready", stream, isClosed: () => closed };
  } catch (error) {
    let failure = error;
    try {
      closeAfter("rollback");
    } catch (cleanupError) {
      failure = combineFailure(error, cleanupError);
    }
    throw failure;
  }
}
