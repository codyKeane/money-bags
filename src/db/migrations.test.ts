import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { REVIEWED_MIGRATION_JOURNAL } from "./migration-manifest";
import { findRepositoryRoot } from "./path";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface MigrationJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

interface AppliedMigration {
  hash: string;
  createdAt: number;
}

const MIGRATIONS_FOLDER = path.join(
  findRepositoryRoot({ moduleDirectory: __dirname }),
  "drizzle",
);
const JOURNAL = JSON.parse(
  readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
) as MigrationJournal;

// COMPATIBILITY LOCK: applied migration SQL is immutable. Never update one of
// these literals merely to make a test pass; append a reviewed migration.
const EXPECTED_MIGRATIONS = [
  {
    idx: 0,
    version: "6",
    when: 1783145819916,
    tag: "0000_hesitant_yellow_claw",
    breakpoints: true,
    sha256: "f6fbc57eab77a346e5c6b8e72d24e1393a15497b4051cde2c4f932648f8dfd31",
  },
  {
    idx: 1,
    version: "6",
    when: 1783146074376,
    tag: "0001_third_skin",
    breakpoints: true,
    sha256: "083430c4c6a7acbe024293efaa1835dfde96377f3a0bc7d08f9df4564b24eed5",
  },
  {
    idx: 2,
    version: "6",
    when: 1783354074001,
    tag: "0002_noisy_bill_hollister",
    breakpoints: true,
    sha256: "3fb428f49b2de20b671756014748d9b877f93142cc4cbec7c4daf417dbf60a78",
  },
  {
    idx: 3,
    version: "6",
    when: 1783392874346,
    tag: "0003_bouncy_odin",
    breakpoints: true,
    sha256: "d16f531ee1e4958c428716fcfdf0ae888b917055a32dc22ec4249bc405ec2de7",
  },
  {
    idx: 4,
    version: "6",
    when: 1783394978597,
    tag: "0004_right_gamma_corps",
    breakpoints: true,
    sha256: "163081861a670360f47dfc52c8934f70bbed808606a8a85f18ffbf4e61baf0f1",
  },
  {
    idx: 5,
    version: "6",
    when: 1784189434031,
    tag: "0005_annotations",
    breakpoints: true,
    sha256: "1a259e7d6f3d70fb1a52ec59ea6202224f950feab72237ac3c7f6121c6981bab",
  },
] as const;

function getAppliedMigrations(sqlite: Database.Database): AppliedMigration[] {
  return sqlite
    .prepare<[], { hash: string; createdAt: number }>(
      `SELECT hash, created_at AS createdAt
       FROM __drizzle_migrations
       ORDER BY created_at`,
    )
    .all();
}

function assertHealthy(sqlite: Database.Database): void {
  expect(sqlite.pragma("quick_check")).toEqual([{ quick_check: "ok" }]);
  expect(sqlite.pragma("foreign_key_check")).toEqual([]);
}

function writeHistoricalMigrationFolder(root: string, lastIndex: number): string {
  const folder = path.join(root, "migrations");
  mkdirSync(path.join(folder, "meta"), { recursive: true });
  const entries = JOURNAL.entries.slice(0, lastIndex + 1);
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    `${JSON.stringify({ ...JOURNAL, entries }, null, 2)}\n`,
  );
  for (const entry of entries) {
    copyFileSync(
      path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
      path.join(folder, `${entry.tag}.sql`),
    );
  }
  return folder;
}

function withMigrationDb(
  lastIndex: number | null,
  run: (sqlite: Database.Database) => void,
): void {
  const dir = mkdtempSync(path.join(tmpdir(), "moneybags-migrations-"));
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(path.join(dir, "fixture.db"));
    sqlite.pragma("foreign_keys = ON");
    if (lastIndex !== null) {
      const historicalFolder = writeHistoricalMigrationFolder(dir, lastIndex);
      migrate(drizzle(sqlite), { migrationsFolder: historicalFolder });
      insertHistoricalFixture(sqlite, lastIndex);
    }
    run(sqlite);
  } finally {
    try {
      sqlite?.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function insertHistoricalFixture(sqlite: Database.Database, lastIndex: number): void {
  const now = 1_700_000_000_000;
  const insert = sqlite.transaction(() => {
    sqlite
      .prepare(
        `INSERT INTO accounts
          (id, name, type, institution, currency, opening_balance_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "acct-main",
        "Fixture Checking",
        "CHECKING",
        "Fixture Bank",
        "CAD",
        12_500,
        now,
        now,
      );
    sqlite
      .prepare(
        `INSERT INTO accounts (id, name, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("acct-defaults", "Fixture Cash", "CASH", now, now);

    if (lastIndex >= 2) {
      sqlite
        .prepare(
          `INSERT INTO categories
            (id, name, color, keywords, exclude_from_spending, monthly_budget_cents, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "cat-food",
          "Fixture Groceries",
          "#123456",
          '["fixture-market"]',
          0,
          50_000,
          now,
        );
      sqlite
        .prepare(
          `INSERT INTO categories
            (id, name, exclude_from_spending, monthly_budget_cents, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("cat-excluded", "Fixture Transfer", 1, null, now);
    } else if (lastIndex >= 1) {
      sqlite
        .prepare(
          `INSERT INTO categories
            (id, name, color, keywords, exclude_from_spending, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "cat-food",
          "Fixture Groceries",
          "#123456",
          '["fixture-market"]',
          0,
          now,
        );
      sqlite
        .prepare(
          `INSERT INTO categories (id, name, exclude_from_spending, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run("cat-excluded", "Fixture Transfer", 1, now);
    } else {
      sqlite
        .prepare(
          `INSERT INTO categories (id, name, color, keywords, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          "cat-food",
          "Fixture Groceries",
          "#123456",
          '["fixture-market"]',
          now,
        );
      sqlite
        .prepare(`INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)`)
        .run("cat-excluded", "Fixture Transfer", now);
    }

    if (lastIndex >= 3) {
      sqlite
        .prepare(
          `INSERT INTO import_batches
            (id, account_id, filename, imported_count, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("batch-fixture", "acct-main", "fixture.csv", 1, now);
    }

    const transactionColumns =
      lastIndex >= 3
        ? "id, date, description, amount_cents, account_id, category_id, import_hash, batch_id, created_at, updated_at"
        : "id, date, description, amount_cents, account_id, category_id, import_hash, created_at, updated_at";
    const transactionValues = lastIndex >= 3 ? "?, ?, ?, ?, ?, ?, ?, ?, ?, ?" : "?, ?, ?, ?, ?, ?, ?, ?, ?";
    const insertTransaction = sqlite.prepare(
      `INSERT INTO transactions (${transactionColumns}) VALUES (${transactionValues})`,
    );
    if (lastIndex >= 3) {
      insertTransaction.run(
        "tx-categorized",
        "2026-01-15",
        "FIXTURE MARKET",
        -4_321,
        "acct-main",
        "cat-food",
        "fixture-hash-categorized",
        "batch-fixture",
        now,
        now,
      );
      insertTransaction.run(
        "tx-uncategorized",
        "2026-01-31",
        "FIXTURE PAY",
        123_456,
        "acct-main",
        null,
        "fixture-hash-uncategorized",
        null,
        now,
        now,
      );
    } else {
      insertTransaction.run(
        "tx-categorized",
        "2026-01-15",
        "FIXTURE MARKET",
        -4_321,
        "acct-main",
        "cat-food",
        "fixture-hash-categorized",
        now,
        now,
      );
      insertTransaction.run(
        "tx-uncategorized",
        "2026-01-31",
        "FIXTURE PAY",
        123_456,
        "acct-main",
        null,
        "fixture-hash-uncategorized",
        now,
        now,
      );
    }

    if (lastIndex >= 4) {
      sqlite
        .prepare(
          `INSERT INTO transactions
            (id, date, description, amount_cents, account_id, category_id, import_hash,
             batch_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "tx-split",
          "2026-01-20",
          "FIXTURE SPLIT PURCHASE",
          -10_000,
          "acct-main",
          null,
          null,
          null,
          now,
          now,
        );
      const insertSplit = sqlite.prepare(
        `INSERT INTO transaction_splits
          (id, transaction_id, category_id, amount_cents)
         VALUES (?, ?, ?, ?)`,
      );
      insertSplit.run("split-food", "tx-split", "cat-food", -6_000);
      insertSplit.run("split-excluded", "tx-split", "cat-excluded", -4_000);
    }

    if (lastIndex >= 5) {
      sqlite
        .prepare(`UPDATE transactions SET notes = ?, tags = ? WHERE id = ?`)
        .run(
          "Historical fixture note",
          '["fixture","reviewed"]',
          "tx-categorized",
        );
    }
  });
  insert();
}

function assertMigrationHistory(sqlite: Database.Database, expectedCount: number): void {
  const applied = getAppliedMigrations(sqlite);
  expect(applied).toHaveLength(expectedCount);
  expect(applied.slice(0, EXPECTED_MIGRATIONS.length)).toEqual(
    EXPECTED_MIGRATIONS.slice(0, expectedCount).map((migration) => ({
      hash: migration.sha256,
      createdAt: migration.when,
    })),
  );
}

function assertCurrentSchema(sqlite: Database.Database): void {
  const tables = sqlite
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
  expect(tables).toEqual([
    "__drizzle_migrations",
    "accounts",
    "categories",
    "import_batches",
    "transaction_splits",
    "transactions",
  ]);

  const transactionColumns = sqlite.pragma("table_info('transactions')") as Array<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>;
  expect(transactionColumns.find((column) => column.name === "notes")).toMatchObject({
    notnull: 1,
    dflt_value: "''",
  });
  expect(transactionColumns.find((column) => column.name === "tags")).toMatchObject({
    notnull: 1,
    dflt_value: "'[]'",
  });

  const expectedIndexes: Record<string, { unique: number; columns: string[] }> = {
    accounts_name_unique: { unique: 1, columns: ["name"] },
    categories_name_unique: { unique: 1, columns: ["name"] },
    transactions_import_hash_unique: { unique: 1, columns: ["import_hash"] },
    transactions_account_date_idx: { unique: 0, columns: ["account_id", "date"] },
    transactions_category_date_idx: { unique: 0, columns: ["category_id", "date"] },
    transactions_date_idx: { unique: 0, columns: ["date"] },
    transactions_batch_idx: { unique: 0, columns: ["batch_id"] },
    transaction_splits_transaction_idx: { unique: 0, columns: ["transaction_id"] },
  };
  for (const [name, expected] of Object.entries(expectedIndexes)) {
    const table = name.startsWith("accounts_")
      ? "accounts"
      : name.startsWith("categories_")
        ? "categories"
        : name.startsWith("transaction_splits_")
          ? "transaction_splits"
          : "transactions";
    const index = (
      sqlite.pragma(`index_list('${table}')`) as Array<{ name: string; unique: number }>
    ).find((candidate) => candidate.name === name);
    expect(index, `missing index ${name}`).toMatchObject({ name, unique: expected.unique });
    const columns = (
      sqlite.pragma(`index_info('${name}')`) as Array<{ name: string }>
    ).map((column) => column.name);
    expect(columns, `columns for ${name}`).toEqual(expected.columns);
  }
}

function assertCurrentForeignKeys(sqlite: Database.Database): void {
  type ForeignKeyRow = {
    table: string;
    from: string;
    to: string;
    on_update: string;
    on_delete: string;
  };
  const foreignKeys = (table: string) =>
    (sqlite.pragma(`foreign_key_list('${table}')`) as ForeignKeyRow[])
      .map((row) => ({
        table: row.table,
        from: row.from,
        to: row.to,
        onUpdate: row.on_update,
        onDelete: row.on_delete,
      }))
      .sort((a, b) => a.from.localeCompare(b.from));

  expect(foreignKeys("transactions")).toEqual([
    {
      table: "accounts",
      from: "account_id",
      to: "id",
      onUpdate: "NO ACTION",
      onDelete: "CASCADE",
    },
    {
      table: "import_batches",
      from: "batch_id",
      to: "id",
      onUpdate: "NO ACTION",
      onDelete: "SET NULL",
    },
    {
      table: "categories",
      from: "category_id",
      to: "id",
      onUpdate: "NO ACTION",
      onDelete: "SET NULL",
    },
  ]);
  expect(foreignKeys("import_batches")).toEqual([
    {
      table: "accounts",
      from: "account_id",
      to: "id",
      onUpdate: "NO ACTION",
      onDelete: "CASCADE",
    },
  ]);
  expect(foreignKeys("transaction_splits")).toEqual([
    {
      table: "categories",
      from: "category_id",
      to: "id",
      onUpdate: "NO ACTION",
      onDelete: "SET NULL",
    },
    {
      table: "transactions",
      from: "transaction_id",
      to: "id",
      onUpdate: "NO ACTION",
      onDelete: "CASCADE",
    },
  ]);
}

function assertPopulatedFixture(sqlite: Database.Database, lastIndex: number): void {
  const accounts = sqlite
    .prepare<
      [],
      {
        id: string;
        name: string;
        type: string;
        institution: string | null;
        currency: string;
        openingBalanceCents: number;
        createdAt: number;
        updatedAt: number;
      }
    >(
      `SELECT id, name, type, institution, currency,
              opening_balance_cents AS openingBalanceCents,
              created_at AS createdAt, updated_at AS updatedAt
       FROM accounts ORDER BY id`,
    )
    .all();
  expect(accounts).toEqual([
    {
      id: "acct-defaults",
      name: "Fixture Cash",
      type: "CASH",
      institution: null,
      currency: "USD",
      openingBalanceCents: 0,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
    {
      id: "acct-main",
      name: "Fixture Checking",
      type: "CHECKING",
      institution: "Fixture Bank",
      currency: "CAD",
      openingBalanceCents: 12_500,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
  ]);

  const categories = sqlite
    .prepare<
      [],
      {
        id: string;
        name: string;
        color: string | null;
        keywords: string;
        excludeFromSpending: number;
        monthlyBudgetCents: number | null;
        createdAt: number;
      }
    >(
      `SELECT id, name, color, keywords,
              exclude_from_spending AS excludeFromSpending,
              monthly_budget_cents AS monthlyBudgetCents,
              created_at AS createdAt
       FROM categories ORDER BY id`,
    )
    .all();
  expect(categories).toEqual([
    {
      id: "cat-excluded",
      name: "Fixture Transfer",
      color: null,
      keywords: "[]",
      excludeFromSpending: lastIndex >= 1 ? 1 : 0,
      monthlyBudgetCents: null,
      createdAt: 1_700_000_000_000,
    },
    {
      id: "cat-food",
      name: "Fixture Groceries",
      color: "#123456",
      keywords: '["fixture-market"]',
      excludeFromSpending: 0,
      monthlyBudgetCents: lastIndex >= 2 ? 50_000 : null,
      createdAt: 1_700_000_000_000,
    },
  ]);

  const transactions = sqlite
    .prepare<
      [],
      {
        id: string;
        date: string;
        description: string;
        amountCents: number;
        accountId: string;
        categoryId: string | null;
        importHash: string | null;
        batchId: string | null;
        notes: string;
        tags: string;
        createdAt: number;
        updatedAt: number;
      }
    >(
      `SELECT id, date, description, amount_cents AS amountCents,
              account_id AS accountId, category_id AS categoryId,
              import_hash AS importHash, batch_id AS batchId,
              notes, tags,
              created_at AS createdAt, updated_at AS updatedAt
       FROM transactions ORDER BY id`,
    )
    .all();
  expect(transactions).toEqual([
    {
      id: "tx-categorized",
      date: "2026-01-15",
      description: "FIXTURE MARKET",
      amountCents: -4_321,
      accountId: "acct-main",
      categoryId: "cat-food",
      importHash: "fixture-hash-categorized",
      batchId: lastIndex >= 3 ? "batch-fixture" : null,
      notes: lastIndex >= 5 ? "Historical fixture note" : "",
      tags: lastIndex >= 5 ? '["fixture","reviewed"]' : "[]",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
    ...(lastIndex >= 4
      ? [
          {
            id: "tx-split",
            date: "2026-01-20",
            description: "FIXTURE SPLIT PURCHASE",
            amountCents: -10_000,
            accountId: "acct-main",
            categoryId: null,
            importHash: null,
            batchId: null,
            notes: "",
            tags: "[]",
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
          },
        ]
      : []),
    {
      id: "tx-uncategorized",
      date: "2026-01-31",
      description: "FIXTURE PAY",
      amountCents: 123_456,
      accountId: "acct-main",
      categoryId: null,
      importHash: "fixture-hash-uncategorized",
      batchId: null,
      notes: "",
      tags: "[]",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
  ]);

  const batches = sqlite
    .prepare<
      [],
      {
        id: string;
        accountId: string;
        filename: string | null;
        importedCount: number;
        skippedCount: number;
        createdAt: number;
      }
    >(
      `SELECT id, account_id AS accountId, filename,
              imported_count AS importedCount, skipped_count AS skippedCount,
              created_at AS createdAt
       FROM import_batches ORDER BY id`,
    )
    .all();
  expect(batches).toEqual(
    lastIndex >= 3
      ? [
          {
            id: "batch-fixture",
            accountId: "acct-main",
            filename: "fixture.csv",
            importedCount: 1,
            skippedCount: 0,
            createdAt: 1_700_000_000_000,
          },
        ]
      : [],
  );

  const splits = sqlite
    .prepare<
      [],
      { id: string; transactionId: string; categoryId: string | null; amountCents: number }
    >(
      `SELECT id, transaction_id AS transactionId, category_id AS categoryId,
              amount_cents AS amountCents
       FROM transaction_splits ORDER BY id`,
    )
    .all();
  expect(splits).toEqual(
    lastIndex >= 4
      ? [
          {
            id: "split-excluded",
            transactionId: "tx-split",
            categoryId: "cat-excluded",
            amountCents: -4_000,
          },
          {
            id: "split-food",
            transactionId: "tx-split",
            categoryId: "cat-food",
            amountCents: -6_000,
          },
        ]
      : [],
  );
  expect(splits.reduce((sum, split) => sum + split.amountCents, 0)).toBe(
    lastIndex >= 4 ? -10_000 : 0,
  );
}

function currentSnapshot(sqlite: Database.Database): unknown {
  const rows = (table: string) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  return {
    accounts: rows("accounts"),
    categories: rows("categories"),
    importBatches: rows("import_batches"),
    transactions: rows("transactions"),
    splits: rows("transaction_splits"),
    migrations: getAppliedMigrations(sqlite),
  };
}

function withRollback(sqlite: Database.Database, run: () => void): void {
  sqlite.exec("SAVEPOINT migration_fk_test");
  try {
    run();
  } finally {
    sqlite.exec("ROLLBACK TO migration_fk_test");
    sqlite.exec("RELEASE migration_fk_test");
  }
}

function assertForeignKeyBehavior(sqlite: Database.Database): void {
  const now = 1_700_000_000_001;
  expect(() =>
    sqlite
      .prepare(
        `INSERT INTO transactions
          (id, date, description, amount_cents, account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("fk-orphan-tx", "2026-02-01", "ORPHAN", -1, "missing-account", now, now),
  ).toThrow(/FOREIGN KEY/);
  expect(() =>
    sqlite
      .prepare(
        `INSERT INTO transaction_splits (id, transaction_id, amount_cents)
         VALUES (?, ?, ?)`,
      )
      .run("fk-orphan-split", "missing-transaction", -1),
  ).toThrow(/FOREIGN KEY/);

  withRollback(sqlite, () => {
    sqlite
      .prepare(
        `INSERT INTO import_batches
          (id, account_id, imported_count, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run("fk-batch", "acct-main", 1, now);
    sqlite
      .prepare(`UPDATE transactions SET batch_id = ? WHERE id = ?`)
      .run("fk-batch", "tx-categorized");
    sqlite.prepare(`DELETE FROM import_batches WHERE id = ?`).run("fk-batch");
    const row = sqlite
      .prepare<[string], { batchId: string | null }>(
        `SELECT batch_id AS batchId FROM transactions WHERE id = ?`,
      )
      .get("tx-categorized");
    expect(row?.batchId).toBeNull();
  });

  withRollback(sqlite, () => {
    sqlite
      .prepare(
        `INSERT INTO transaction_splits
          (id, transaction_id, category_id, amount_cents)
         VALUES (?, ?, ?, ?)`,
      )
      .run("fk-category-split", "tx-uncategorized", "cat-food", 123_456);
    sqlite.prepare(`DELETE FROM categories WHERE id = ?`).run("cat-food");
    const transaction = sqlite
      .prepare<[string], { categoryId: string | null }>(
        `SELECT category_id AS categoryId FROM transactions WHERE id = ?`,
      )
      .get("tx-categorized");
    const split = sqlite
      .prepare<[string], { categoryId: string | null }>(
        `SELECT category_id AS categoryId FROM transaction_splits WHERE id = ?`,
      )
      .get("fk-category-split");
    expect(transaction?.categoryId).toBeNull();
    expect(split?.categoryId).toBeNull();
  });

  withRollback(sqlite, () => {
    sqlite
      .prepare(
        `INSERT INTO transaction_splits
          (id, transaction_id, category_id, amount_cents)
         VALUES (?, ?, ?, ?)`,
      )
      .run("fk-cascade-split", "tx-categorized", "cat-food", -4_321);
    sqlite.prepare(`DELETE FROM transactions WHERE id = ?`).run("tx-categorized");
    const split = sqlite
      .prepare<[string], { count: number }>(
        `SELECT count(*) AS count FROM transaction_splits WHERE id = ?`,
      )
      .get("fk-cascade-split");
    expect(split?.count).toBe(0);
  });

  withRollback(sqlite, () => {
    sqlite.prepare(`DELETE FROM accounts WHERE id = ?`).run("acct-main");
    const transactionCount = sqlite
      .prepare<[], { count: number }>(`SELECT count(*) AS count FROM transactions`)
      .get()?.count;
    const batchCount = sqlite
      .prepare<[], { count: number }>(`SELECT count(*) AS count FROM import_batches`)
      .get()?.count;
    const splitCount = sqlite
      .prepare<[], { count: number }>(`SELECT count(*) AS count FROM transaction_splits`)
      .get()?.count;
    expect({ transactionCount, batchCount, splitCount }).toEqual({
      transactionCount: 0,
      batchCount: 0,
      splitCount: 0,
    });
  });
}

describe("migration compatibility", () => {
  it("pins all reviewed journal entries and migration SQL bytes", () => {
    // This independent test oracle intentionally duplicates the production
    // manifest so a coordinated journal/manifest edit cannot bless itself.
    expect(REVIEWED_MIGRATION_JOURNAL).toEqual({
      version: "7",
      dialect: "sqlite",
      entries: EXPECTED_MIGRATIONS,
    });
    expect(JOURNAL.version).toBe("7");
    expect(JOURNAL.dialect).toBe("sqlite");
    expect(JOURNAL.entries.length).toBeGreaterThanOrEqual(EXPECTED_MIGRATIONS.length);
    expect(JOURNAL.entries.slice(0, EXPECTED_MIGRATIONS.length)).toEqual(
      EXPECTED_MIGRATIONS.map((migration) => ({
        idx: migration.idx,
        version: migration.version,
        when: migration.when,
        tag: migration.tag,
        breakpoints: migration.breakpoints,
      })),
    );
    expect(JOURNAL.entries.map((entry) => entry.idx)).toEqual(
      JOURNAL.entries.map((_entry, index) => index),
    );
    for (let index = 1; index < JOURNAL.entries.length; index++) {
      expect(JOURNAL.entries[index]?.when).toBeGreaterThan(JOURNAL.entries[index - 1]?.when ?? 0);
    }
    for (const migration of EXPECTED_MIGRATIONS) {
      const bytes = readFileSync(path.join(MIGRATIONS_FOLDER, `${migration.tag}.sql`));
      expect(createHash("sha256").update(bytes).digest("hex"), migration.tag).toBe(
        migration.sha256,
      );
    }
  });

  it("migrates a fresh empty database to the current schema idempotently", () => {
    withMigrationDb(null, (sqlite) => {
      const db = drizzle(sqlite);
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      assertCurrentSchema(sqlite);
      assertCurrentForeignKeys(sqlite);
      assertMigrationHistory(sqlite, JOURNAL.entries.length);
      assertHealthy(sqlite);
      const before = currentSnapshot(sqlite);
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(currentSnapshot(sqlite)).toEqual(before);
      assertHealthy(sqlite);
    });
  });

  it.each(
    EXPECTED_MIGRATIONS.map((migration, lastIndex) => ({
      tag: migration.tag,
      lastIndex,
    })),
  )("upgrades a populated $tag database to current", ({ lastIndex }) => {
    withMigrationDb(lastIndex, (sqlite) => {
      assertMigrationHistory(sqlite, lastIndex + 1);
      assertHealthy(sqlite);

      const db = drizzle(sqlite);
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      assertCurrentSchema(sqlite);
      assertCurrentForeignKeys(sqlite);
      assertMigrationHistory(sqlite, JOURNAL.entries.length);
      assertPopulatedFixture(sqlite, lastIndex);
      assertHealthy(sqlite);

      const before = currentSnapshot(sqlite);
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      expect(currentSnapshot(sqlite)).toEqual(before);
      assertPopulatedFixture(sqlite, lastIndex);
      assertForeignKeyBehavior(sqlite);
      assertHealthy(sqlite);
    });
  });
});
