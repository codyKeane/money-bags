import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    amountCents: integer("amount_cents").notNull(), // signed: negative = outflow
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
