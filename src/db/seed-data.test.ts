import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ensureDefaultCategories } from "./default-categories";
import { seedDemoData } from "./seed-data";
import { DemoSeedRefusal } from "./seed-target";
import {
  accounts,
  categories,
  importBatches,
  transactions,
  transactionSplits,
} from "./schema";
import { DEFAULT_CATEGORIES } from "../lib/default-categories";
import { isValidIsoDate } from "../lib/month";
import { setupTestDbPerTest } from "../test/test-db";
import type { Db } from "./client";
import { REVIEWED_MIGRATIONS } from "./migration-manifest";

const FIXED_CLOCK = () => new Date("2026-01-01T00:00:00.000Z");

function ledgerSnapshot(db: Db) {
  return {
    accounts: db.select().from(accounts).orderBy(asc(accounts.id)).all(),
    categories: db.select().from(categories).orderBy(asc(categories.id)).all(),
    importBatches: db.select().from(importBatches).orderBy(asc(importBatches.id)).all(),
    transactions: db.select().from(transactions).orderBy(asc(transactions.id)).all(),
    splits: db
      .select()
      .from(transactionSplits)
      .orderBy(asc(transactionSplits.id))
      .all(),
  };
}

function expectIneligibleWithoutMutation(db: Db): void {
  const before = ledgerSnapshot(db);
  expect(() => seedDemoData(db, FIXED_CLOCK)).toThrowError(DemoSeedRefusal);
  expect(ledgerSnapshot(db)).toEqual(before);
}

function insertSyntheticAccount(db: Db, name = "Synthetic Existing Account") {
  return db
    .insert(accounts)
    .values({
      name,
      type: "CHECKING",
      institution: "Synthetic Test Bank",
      currency: "USD",
      openingBalanceCents: 12_345,
    })
    .returning()
    .get();
}

function insertSyntheticTransaction(db: Db, accountId: string, imported: boolean) {
  return db
    .insert(transactions)
    .values({
      accountId,
      categoryId: null,
      date: "2025-12-31",
      description: imported ? "SYNTHETIC IMPORT" : "SYNTHETIC MANUAL",
      amountCents: -1_234,
      importHash: imported ? `synthetic-${crypto.randomUUID()}` : null,
    })
    .returning()
    .get();
}

describe("seedDemoData", () => {
  const ctx = setupTestDbPerTest("moneybags-seed-data-");

  it("reuses exact untouched defaults without changing their ids or timestamps", () => {
    ensureDefaultCategories(ctx.db);
    const before = ctx.db
      .select()
      .from(categories)
      .orderBy(asc(categories.name))
      .all();

    expect(seedDemoData(ctx.db, FIXED_CLOCK)).toEqual({
      accounts: 2,
      categories: DEFAULT_CATEGORIES.length,
      transactions: 132,
    });

    const after = ctx.db
      .select()
      .from(categories)
      .orderBy(asc(categories.name))
      .all();
    expect(after).toEqual(before);
    expect(ctx.db.select().from(accounts).all()).toHaveLength(2);
    expect(ctx.db.select().from(transactions).all()).toHaveLength(132);
    expect(ctx.db.select().from(importBatches).all()).toHaveLength(0);
    expect(ctx.db.select().from(transactionSplits).all()).toHaveLength(0);
    expect(ctx.db.select().from(accounts).all().every((row) => row.currency === "USD")).toBe(
      true,
    );
  });

  it("atomically installs defaults when the current schema has no categories", () => {
    expect(seedDemoData(ctx.db, FIXED_CLOCK)).toEqual({
      accounts: 2,
      categories: DEFAULT_CATEGORIES.length,
      transactions: 132,
    });

    const rows = ctx.db.select().from(categories).orderBy(asc(categories.name)).all();
    expect(rows).toHaveLength(DEFAULT_CATEGORIES.length);
    for (const definition of DEFAULT_CATEGORIES) {
      expect(rows.find((row) => row.name === definition.name)).toMatchObject({
        color: definition.color,
        keywords: JSON.stringify(definition.keywords),
        excludeFromSpending: definition.excludeFromSpending ?? false,
        monthlyBudgetCents: null,
      });
    }
  });

  it("uses a fixed UTC month anchor to generate valid dates across a year boundary", () => {
    seedDemoData(ctx.db, FIXED_CLOCK);
    const rows = ctx.db
      .select({ date: transactions.date })
      .from(transactions)
      .orderBy(asc(transactions.date))
      .all();

    expect(rows).toHaveLength(132);
    expect(rows[0]?.date).toMatch(/^2025-08-/);
    expect(rows.at(-1)?.date).toMatch(/^2026-01-/);
    expect(rows.every((row) => isValidIsoDate(row.date))).toBe(true);
  });

  it("refuses a second run without changing the seeded ledger", () => {
    seedDemoData(ctx.db, FIXED_CLOCK);
    expectIneligibleWithoutMutation(ctx.db);
  });

  it("rechecks reviewed migration history inside the write transaction", () => {
    ctx.db.run(
      sql`DELETE FROM __drizzle_migrations WHERE created_at = ${REVIEWED_MIGRATIONS.at(-1)?.when}`,
    );
    const before = ledgerSnapshot(ctx.db);

    expect(() => seedDemoData(ctx.db, FIXED_CLOCK)).toThrowError(
      expect.objectContaining({ reason: "schema-not-current" }),
    );
    expect(ledgerSnapshot(ctx.db)).toEqual(before);
  });

  it.each([
    ["an existing account", (db: Db) => void insertSyntheticAccount(db)],
    [
      "a manual transaction",
      (db: Db) => {
        const account = insertSyntheticAccount(db);
        insertSyntheticTransaction(db, account.id, false);
      },
    ],
    [
      "an imported transaction",
      (db: Db) => {
        const account = insertSyntheticAccount(db);
        insertSyntheticTransaction(db, account.id, true);
      },
    ],
    [
      "an import batch",
      (db: Db) => {
        const account = insertSyntheticAccount(db);
        db.insert(importBatches)
          .values({
            accountId: account.id,
            filename: "synthetic.csv",
            importedCount: 1,
            skippedCount: 0,
          })
          .run();
      },
    ],
    [
      "a transaction split",
      (db: Db) => {
        const account = insertSyntheticAccount(db);
        const transaction = insertSyntheticTransaction(db, account.id, false);
        db.insert(transactionSplits)
          .values({ transactionId: transaction.id, categoryId: null, amountCents: -1_234 })
          .run();
      },
    ],
    [
      "a custom category",
      (db: Db) => {
        db.insert(categories)
          .values({
            name: "Synthetic Custom",
            color: null,
            keywords: "[]",
            excludeFromSpending: false,
            monthlyBudgetCents: null,
          })
          .run();
      },
    ],
    [
      "a changed default keyword",
      (db: Db) => {
        ensureDefaultCategories(db);
        db.update(categories)
          .set({ keywords: '["synthetic-change"]' })
          .where(eq(categories.name, "Groceries"))
          .run();
      },
    ],
    [
      "a changed default exclusion flag",
      (db: Db) => {
        ensureDefaultCategories(db);
        db.update(categories)
          .set({ excludeFromSpending: true })
          .where(eq(categories.name, "Groceries"))
          .run();
      },
    ],
    [
      "a category budget",
      (db: Db) => {
        ensureDefaultCategories(db);
        db.update(categories)
          .set({ monthlyBudgetCents: 50_000 })
          .where(eq(categories.name, "Groceries"))
          .run();
      },
    ],
  ])("refuses and preserves a target with %s", (_label, arrange) => {
    arrange(ctx.db);
    expectIneligibleWithoutMutation(ctx.db);
  });

  it.each([
    [
      "transaction",
      (db: Db) => {
        db.insert(transactions)
          .values({
            id: "synthetic-orphan-transaction",
            accountId: "synthetic-missing-account",
            categoryId: null,
            date: "2025-12-31",
            description: "SYNTHETIC ORPHAN",
            amountCents: -1,
          })
          .run();
      },
    ],
    [
      "import batch",
      (db: Db) => {
        db.insert(importBatches)
          .values({
            id: "synthetic-orphan-batch",
            accountId: "synthetic-missing-account",
            importedCount: 1,
            skippedCount: 0,
          })
          .run();
      },
    ],
    [
      "split",
      (db: Db) => {
        db.insert(transactionSplits)
          .values({
            id: "synthetic-orphan-split",
            transactionId: "synthetic-missing-transaction",
            categoryId: null,
            amountCents: -1,
          })
          .run();
      },
    ],
  ])("independently refuses an orphan %s sentinel", (_label, arrange) => {
    ctx.db.run(sql.raw("PRAGMA foreign_keys = OFF"));
    try {
      arrange(ctx.db);
    } finally {
      ctx.db.run(sql.raw("PRAGMA foreign_keys = ON"));
    }
    expect(ctx.db.select().from(accounts).all()).toHaveLength(0);
    expectIneligibleWithoutMutation(ctx.db);
  });

  it("does not overwrite a colliding demo account name", () => {
    insertSyntheticAccount(ctx.db, "Everyday Checking");
    const before = ctx.db.select().from(accounts).all();

    expectIneligibleWithoutMutation(ctx.db);
    expect(ctx.db.select().from(accounts).all()).toEqual(before);
    expect(before[0]?.openingBalanceCents).toBe(12_345);
  });

  it("rolls back categories, accounts, and earlier transactions after an insert fault", () => {
    ctx.db.run(
      sql.raw(`
        CREATE TRIGGER synthetic_seed_failure
        BEFORE INSERT ON transactions
        WHEN NEW.description = 'SHIELD AUTO INSURANCE'
        BEGIN
          SELECT RAISE(ABORT, 'synthetic seed insert failure');
        END
      `),
    );

    expect(() => seedDemoData(ctx.db, FIXED_CLOCK)).toThrow(/synthetic seed insert failure/);
    expect(ledgerSnapshot(ctx.db)).toEqual({
      accounts: [],
      categories: [],
      importBatches: [],
      transactions: [],
      splits: [],
    });
  });

  it("rejects an invalid injected clock before starting writes", () => {
    expect(() => seedDemoData(ctx.db, () => new Date(Number.NaN))).toThrow(
      "Demo seed clock must return a finite Date.",
    );
    expect(ledgerSnapshot(ctx.db)).toEqual({
      accounts: [],
      categories: [],
      importBatches: [],
      transactions: [],
      splits: [],
    });
  });
});
