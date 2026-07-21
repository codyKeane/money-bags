import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const timestamps = {
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at")
    .notNull()
    .$defaultFn(() => Date.now())
    .$onUpdateFn(() => Date.now()),
};

export const accounts = sqliteTable("accounts", {
  id: id(),
  name: text("name").notNull().unique(),
  // CHECKING | SAVINGS | CREDIT_CARD | CASH | INVESTMENT — validated in code
  type: text("type").notNull(),
  institution: text("institution"),
  currency: text("currency").notNull().default("USD"),
  openingBalanceCents: integer("opening_balance_cents").notNull().default(0),
  // Null means the opening amount is a current baseline rather than a point
  // that can be placed on a historical balance timeline.
  openingBalanceDate: text("opening_balance_date"),
  ...timestamps,
});

export const categories = sqliteTable("categories", {
  id: id(),
  name: text("name").notNull().unique(),
  color: text("color"), // hex, used by charts/badges
  keywords: text("keywords").notNull().default("[]"), // JSON string[] for auto-categorization
  // transfers between own accounts are not income/spending — aggregates skip them
  excludeFromSpending: integer("exclude_from_spending", { mode: "boolean" })
    .notNull()
    .default(false),
  // Optional monthly spending target in cents (positive). null = no budget set;
  // budget vs actual only surfaces categories that have one.
  monthlyBudgetCents: integer("monthly_budget_cents"),
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(() => Date.now()),
});

// One row per CSV import that inserted at least one transaction. Lets the user
// undo a whole import (delete every row it added) — CLAUDE.md's "delete the
// corrupted rows first" workflow needs this. Imports that add nothing (all
// duplicates) record no batch.
export const importBatches = sqliteTable("import_batches", {
  id: id(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  filename: text("filename"), // original CSV filename when known (UI upload / CLI path)
  importedCount: integer("imported_count").notNull(), // rows inserted by this import
  skippedCount: integer("skipped_count").notNull().default(0), // duplicates skipped
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(() => Date.now()),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: id(),
    date: text("date").notNull(), // YYYY-MM-DD (statement dates are date-only)
    description: text("description").notNull(),
    merchant: text("merchant").notNull().default(""),
    notes: text("notes").notNull().default(""),
    // Canonical JSON string[]; service reads tolerate malformed historical
    // values while every supported write stores bounded normalized tags.
    tagsJson: text("tags").notNull().default("[]"),
    amountCents: integer("amount_cents").notNull(), // signed: negative = outflow
    cleared: integer("cleared", { mode: "boolean" }).notNull().default(false),
    // Row-level override for category-based spending inclusion. This never
    // changes the category or its stored budget.
    excludeFromSpending: integer("exclude_from_spending", { mode: "boolean" })
      .notNull()
      .default(false),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    importHash: text("import_hash").unique(), // null for manually created rows
    // The import that created this row; null for manual rows and rows imported
    // before batch tracking existed. set null (not cascade) so undo is an
    // explicit two-step delete in the service, not a silent FK side effect.
    batchId: text("batch_id").references(() => importBatches.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("transactions_account_date_idx").on(t.accountId, t.date),
    index("transactions_category_date_idx").on(t.categoryId, t.date),
    index("transactions_date_idx").on(t.date),
    index("transactions_batch_idx").on(t.batchId), // undo deletes WHERE batch_id = ?
  ],
);

// A transaction can be split across categories (e.g. one store run = groceries
// + household + a gift). When a transaction has ≥1 split rows, the splits define
// its categorization for all spending aggregates and its own categoryId is
// ignored; the splits' signed amounts must sum to the transaction amountCents.
// Transaction services enforce that invariant inside write-reserving SQLite
// transactions. Remove all splits to revert to the single categoryId.
export const transactionSplits = sqliteTable(
  "transaction_splits",
  {
    id: id(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    amountCents: integer("amount_cents").notNull(), // signed; same sign convention as transactions
  },
  (t) => [index("transaction_splits_transaction_idx").on(t.transactionId)],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type ImportBatch = typeof importBatches.$inferSelect;
export type NewImportBatch = typeof importBatches.$inferInsert;
export type TransactionSplit = typeof transactionSplits.$inferSelect;
export type NewTransactionSplit = typeof transactionSplits.$inferInsert;

// A duplicate import override is deliberately separate from the frozen
// importHash. The overridden transaction keeps importHash null, while this row
// preserves exactly which source row the user chose to import a second time.
export const importDuplicateOverrides = sqliteTable(
  "import_duplicate_overrides",
  {
    id: id(),
    batchId: text("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id")
      .notNull()
      .unique()
      .references(() => transactions.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    sourceFingerprint: text("source_fingerprint").notNull(),
    sourceRowNumber: integer("source_row_number").notNull(),
    importHash: text("import_hash").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    uniqueIndex("import_duplicate_source_unique").on(
      t.accountId,
      t.sourceFingerprint,
      t.sourceRowNumber,
    ),
    index("import_duplicate_hash_idx").on(t.accountId, t.importHash),
  ],
);

// One-to-one explicit transfer pair. Both rows stay in the ledger and export;
// aggregate services suppress them through a NOT EXISTS predicate.
export const transferPairs = sqliteTable(
  "transfer_pairs",
  {
    id: id(),
    sourceTransactionId: text("source_transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    destinationTransactionId: text("destination_transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    uniqueIndex("transfer_pairs_source_unique").on(t.sourceTransactionId),
    uniqueIndex("transfer_pairs_destination_unique").on(t.destinationTransactionId),
  ],
);

// A refund may be partial and several refunds may point to one original. The
// refund row itself owns its category/splits so no historical row is rewritten.
export const refundLinks = sqliteTable(
  "refund_links",
  {
    id: id(),
    refundTransactionId: text("refund_transaction_id")
      .notNull()
      .unique()
      .references(() => transactions.id, { onDelete: "cascade" }),
    originalTransactionId: text("original_transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [index("refund_links_original_idx").on(t.originalTransactionId)],
);

export type ImportDuplicateOverride = typeof importDuplicateOverrides.$inferSelect;
export type NewImportDuplicateOverride = typeof importDuplicateOverrides.$inferInsert;
export type TransferPair = typeof transferPairs.$inferSelect;
export type NewTransferPair = typeof transferPairs.$inferInsert;
export type RefundLink = typeof refundLinks.$inferSelect;
export type NewRefundLink = typeof refundLinks.$inferInsert;
