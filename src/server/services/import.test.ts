import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { setupTestDbPerTest } from "@/test/test-db";
import {
  accounts,
  categories,
  importBatches,
  transactions,
  transactionSplits,
} from "@/db/schema";
import {
  getRecentImportBatches,
  importStatement,
  undoImport,
} from "./import";
import { getAccountsWithBalances, getNetWorth, getOrCreateAccountByName } from "./accounts";
import { createTransaction } from "./transactions";
import { getMonthlySpendingByCategory, getMonthlySummary } from "./summary";

const CSV = [
  "Date,Description,Amount",
  "2026-06-01,ACME PAYROLL,2600.00",
  '2026-06-03,"WHOLE HARVEST MARKET, AISLE 9",-78.12',
  "2026-06-03,COFFEE SHOP,-4.50",
  "2026-06-03,COFFEE SHOP,-4.50", // legit duplicate: same day, same amount
  "2026-06-25,CARD PAYMENT TRANSFER,-700.00",
].join("\n");

async function mustGetOrCreateAccount(name: string, db: Db) {
  const result = await getOrCreateAccountByName(name, "CHECKING", "USD", db);
  if (result.status === "invalid-input") throw new Error("account fixture failed");
  return result.account;
}

function existingAccount(accountId: string) {
  return { kind: "existing" as const, accountId };
}

function ledgerSnapshot(db: Db) {
  return {
    accounts: db.select().from(accounts).all(),
    categories: db.select().from(categories).all(),
    batches: db.select().from(importBatches).all(),
    transactions: db.select().from(transactions).all(),
    splits: db.select().from(transactionSplits).all(),
  };
}

describe("importStatement (integration, temp DB)", () => {
  const ctx = setupTestDbPerTest("finance-test-");
  let db: Db;
  let accountId: string;

  beforeEach(async () => {
    db = ctx.db;
    await db.insert(categories).values([
      { name: "Groceries", keywords: JSON.stringify(["market"]) },
      { name: "Income", keywords: JSON.stringify(["payroll"]) },
      {
        name: "Transfers",
        keywords: JSON.stringify(["transfer"]),
        excludeFromSpending: true,
      },
    ]);
    const account = await mustGetOrCreateAccount("Test Checking", db);
    accountId = account.id;
  });

  it("imports all rows including same-day identical ones, auto-categorized", async () => {
    const result = await importStatement({ account: existingAccount(accountId), csvText: CSV }, db);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.imported).toBe(5);

    const spending = await getMonthlySpendingByCategory("2026-06", db);
    const groceries = spending.find((s) => s.categoryName === "Groceries");
    expect(groceries?.spentCents).toBe(7812);
    // uncategorized coffee rows still count, transfers do not
    const uncategorized = spending.find((s) => s.categoryId === null);
    expect(uncategorized?.spentCents).toBe(900);
    expect(spending.find((s) => s.categoryName === "Transfers")).toBeUndefined();

    const summary = await getMonthlySummary("2026-06", db);
    expect(summary.incomeCents).toBe(260000);
    expect(summary.spendingCents).toBe(7812 + 900); // transfer excluded
  });

  it("re-importing the same file imports 0 and reports every row as skipped", async () => {
    const first = await importStatement({ account: existingAccount(accountId), csvText: CSV }, db);
    expect(first.imported).toBe(5);

    const result = await importStatement({ account: existingAccount(accountId), csvText: CSV }, db);
    expect(result.imported).toBe(0);
    expect(result.skipped).toHaveLength(5);
    expect(result.skipped[0]).toMatchObject({ description: "ACME PAYROLL" });
  });

  it("balances reflect opening balance plus imported rows", async () => {
    const result = await importStatement({ account: existingAccount(accountId), csvText: CSV }, db);
    expect(result.imported).toBe(5);

    const [account] = await getAccountsWithBalances(db);
    expect(account?.balanceCents).toBe(260000 - 7812 - 450 - 450 - 70000);
    expect(await getNetWorth(db)).toBe(account?.balanceCents);
  });

  it("returns typed account/input failures without creating a batch or transaction", async () => {
    const unknown = await importStatement(
      { account: existingAccount("missing-account"), csvText: CSV },
      db,
    );
    expect(unknown).toMatchObject({ status: "unknown-account", imported: 0, batchId: null });

    const invalidFilename = await importStatement(
      { account: existingAccount(accountId), csvText: CSV, filename: "x".repeat(256) },
      db,
    );
    expect(invalidFilename).toMatchObject({
      status: "invalid-input",
      field: "filename",
      imported: 0,
    });
    expect(await db.select().from(transactions)).toHaveLength(0);
    expect(await getRecentImportBatches(50, db)).toHaveLength(0);
  });

  it("returns an unknown-account result when the target is deleted before the transaction", async () => {
    const originalTransaction = db.transaction.bind(db);
    let intercepted = false;
    const raceDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "transaction") {
          return Reflect.get(target, property, receiver);
        }

        return new Proxy(originalTransaction, {
          apply(transaction, thisArgument, argumentsList) {
            if (!intercepted) {
              intercepted = true;
              target.delete(accounts).where(eq(accounts.id, accountId)).run();
            }
            return Reflect.apply(transaction, thisArgument, argumentsList);
          },
        });
      },
    });

    const result = await importStatement(
      { account: existingAccount(accountId), csvText: CSV },
      raceDb,
    );

    expect(intercepted).toBe(true);
    expect(result).toMatchObject({
      status: "unknown-account",
      imported: 0,
      batchId: null,
    });
    expect(await db.select().from(importBatches)).toHaveLength(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it.each([".", "..", "bad\0name.csv", "bad\x80name.csv", "x".repeat(256)])(
    "rejects unsafe filename %j without changing the ledger",
    async (filename) => {
      const before = ledgerSnapshot(db);

      const result = await importStatement(
        { account: existingAccount(accountId), csvText: CSV, filename },
        db,
      );

      expect(result).toMatchObject({ status: "invalid-input", field: "filename" });
      expect(ledgerSnapshot(db)).toEqual(before);
    },
  );

  it("stores only the NFC basename of a Unicode filename", async () => {
    const result = await importStatement(
      {
        account: existingAccount(accountId),
        csvText: CSV,
        filename: "C:\\synthetic\\cafe\u0301.csv",
      },
      db,
    );

    expect(result.status).toBe("completed");
    const batch = (await getRecentImportBatches(50, db)).find(
      (candidate) => candidate.id === result.batchId,
    );
    expect(batch?.filename).toBe("café.csv");
  });

  it("checks a ready header-only target but rejects an invalid file before account lookup", async () => {
    const headerOnly = await importStatement(
      {
        account: existingAccount("missing-account"),
        csvText: "Date,Description,Amount",
      },
      db,
    );
    expect(headerOnly).toMatchObject({
      status: "unknown-account",
      imported: 0,
      batchId: null,
    });

    const allInvalid = await importStatement(
      {
        account: existingAccount("missing-account"),
        csvText: "Date,Description,Amount\nnot-a-date,THING,1.00",
      },
      db,
    );
    expect(allInvalid).toMatchObject({ status: "invalid-file", imported: 0, batchId: null });
    expect(allInvalid.errors).toHaveLength(1);
    expect(await db.select().from(transactions)).toHaveLength(0);
    expect(await getRecentImportBatches(50, db)).toHaveLength(0);
  });

  it("turns an overlong parsed description into a row error instead of persisting it", async () => {
    const csv = `Date,Description,Amount\n2026-06-01,${"x".repeat(501)},1.00`;
    const result = await importStatement(
      { account: existingAccount(accountId), csvText: csv },
      db,
    );
    expect(result).toMatchObject({ status: "invalid-file", imported: 0, batchId: null });
    expect(result.errors).toEqual([
      { rowNumber: 2, message: "Transaction description must be 1 to 500 characters" },
    ]);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it.each([
    [
      "an ambiguous auto date",
      {
        account: existingAccount("unused"),
        csvText: "Date,Description,Amount\n03/04/2026,AMBIGUOUS,-1.00\n",
      },
      "date-format-required",
    ],
    [
      "a mixed valid and invalid file",
      {
        account: existingAccount("unused"),
        csvText:
          "Date,Description,Amount\n2026-06-01,VALID,-1.00\n2026-06-02,BAD,garbage\n",
      },
      "invalid-file",
    ],
    [
      "an invalid column map",
      {
        account: existingAccount("unused"),
        csvText: "Date,Description,Amount\n2026-06-01,VALID,-1.00\n",
        columnMap: {},
      },
      "invalid-column-map",
    ],
  ])("leaves the full ledger unchanged for %s", async (_label, partial, status) => {
    const before = ledgerSnapshot(db);
    const result = await importStatement(
      { ...partial, account: existingAccount(accountId) },
      db,
    );
    expect(result.status).toBe(status);
    expect(ledgerSnapshot(db)).toEqual(before);
  });

  it("creates a normalized by-name account and rows in the import transaction", async () => {
    const result = await importStatement(
      {
        account: {
          kind: "by-name",
          name: "  CLI Checking  ",
          type: "CHECKING",
          currency: "usd",
        },
        csvText: "Date,Description,Amount\n2026-06-01,CLI ROW,-1.00\n",
      },
      db,
    );
    expect(result).toMatchObject({
      status: "completed",
      imported: 1,
      account: {
        name: "CLI Checking",
        type: "CHECKING",
        currency: "USD",
        created: true,
      },
    });
    expect(db.select().from(accounts).all()).toHaveLength(2);
  });

  it("reuses only a compatible by-name account", async () => {
    const compatible = await importStatement(
      {
        account: { kind: "by-name", name: "Test Checking", type: "CHECKING", currency: "USD" },
        csvText: "Date,Description,Amount\n2026-06-01,COMPATIBLE,-1.00\n",
      },
      db,
    );
    expect(compatible).toMatchObject({
      status: "completed",
      account: { id: accountId, created: false },
    });

    for (const account of [
      { kind: "by-name" as const, name: "Test Checking", type: "SAVINGS" as const, currency: "USD" },
      { kind: "by-name" as const, name: "Test Checking", type: "CHECKING" as const, currency: "EUR" },
    ]) {
      const before = ledgerSnapshot(db);
      const conflict = await importStatement(
        {
          account,
          csvText: "Date,Description,Amount\n2026-06-02,CONFLICT,-2.00\n",
        },
        db,
      );
      expect(conflict.status).toBe("account-conflict");
      expect(ledgerSnapshot(db)).toEqual(before);
    }
  });
});

describe("by-name import atomicity on a fresh schema", () => {
  const ctx = setupTestDbPerTest("finance-import-atomic-");

  it("installs defaults, creates the account, batch, and row together", async () => {
    const result = await importStatement(
      {
        account: { kind: "by-name", name: "Atomic Account", type: "CHECKING", currency: "USD" },
        csvText: "Date,Description,Amount\n2026-06-01,WHOLE HARVEST MARKET,-1.00\n",
      },
      ctx.db,
    );
    expect(result).toMatchObject({ status: "completed", imported: 1 });
    expect(ctx.db.select().from(accounts).all()).toHaveLength(1);
    expect(ctx.db.select().from(categories).all()).toHaveLength(12);
    expect(ctx.db.select().from(importBatches).all()).toHaveLength(1);
    expect(ctx.db.select().from(transactions).all()).toHaveLength(1);
  });

  it("rolls back defaults and account creation when a later insert fails", async () => {
    ctx.db.run(
      sql.raw(`
        CREATE TRIGGER synthetic_import_failure
        BEFORE INSERT ON transactions
        BEGIN
          SELECT RAISE(ABORT, 'synthetic import insert failure');
        END
      `),
    );

    await expect(
      importStatement(
        {
          account: { kind: "by-name", name: "Rolled Back", type: "CHECKING", currency: "USD" },
          csvText: "Date,Description,Amount\n2026-06-01,SYNTHETIC,-1.00\n",
        },
        ctx.db,
      ),
    ).rejects.toThrow(/synthetic import insert failure/);
    expect(ledgerSnapshot(ctx.db)).toEqual({
      accounts: [],
      categories: [],
      batches: [],
      transactions: [],
      splits: [],
    });
  });

  it("does not install defaults when a same-name target is incompatible", async () => {
    ctx.db
      .insert(accounts)
      .values({ name: "Existing", type: "SAVINGS", currency: "USD" })
      .run();
    const before = ledgerSnapshot(ctx.db);
    const result = await importStatement(
      {
        account: { kind: "by-name", name: "Existing", type: "CHECKING", currency: "USD" },
        csvText: "Date,Description,Amount\n2026-06-01,SYNTHETIC,-1.00\n",
      },
      ctx.db,
    );
    expect(result.status).toBe("account-conflict");
    expect(ledgerSnapshot(ctx.db)).toEqual(before);
  });
});

describe("import batches + undo (integration, temp DB)", () => {
  const ctx = setupTestDbPerTest("finance-batches-");
  let db: Db;
  let accountId: string;

  beforeEach(async () => {
    db = ctx.db;
    await db.insert(categories).values([
      { name: "Groceries", keywords: JSON.stringify(["market"]) },
      { name: "Income", keywords: JSON.stringify(["payroll"]) },
      {
        name: "Transfers",
        keywords: JSON.stringify(["transfer"]),
        excludeFromSpending: true,
      },
    ]);
    const account = await mustGetOrCreateAccount("Batch Checking", db);
    accountId = account.id;
  });

  it("records a batch with counts + filename and stamps every imported row", async () => {
    const result = await importStatement(
      { account: existingAccount(accountId), csvText: CSV, filename: "june.csv" },
      db,
    );
    expect(result.imported).toBe(5);
    expect(result.batchId).toBeTypeOf("string");
    const batchId = result.batchId ?? "";

    const batch = (await getRecentImportBatches(50, db)).find((b) => b.id === batchId);
    expect(batch).toMatchObject({
      accountName: "Batch Checking",
      filename: "june.csv",
      importedCount: 5,
      skippedCount: 0,
    });

    const stamped = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.batchId, batchId));
    expect(stamped).toHaveLength(5);
  });

  it("re-importing the same file records no new batch (nothing to undo)", async () => {
    const first = await importStatement(
      { account: existingAccount(accountId), csvText: CSV, filename: "june.csv" },
      db,
    );
    expect(first.imported).toBe(5);

    const before = await getRecentImportBatches(50, db);
    const result = await importStatement(
      { account: existingAccount(accountId), csvText: CSV, filename: "june.csv" },
      db,
    );
    expect(result.imported).toBe(0);
    expect(result.batchId).toBeNull();
    const after = await getRecentImportBatches(50, db);
    expect(after).toHaveLength(before.length);
  });

  it("undo deletes exactly the batch's rows and leaves manual rows untouched", async () => {
    const imported = await importStatement(
      { account: existingAccount(accountId), csvText: CSV, filename: "june.csv" },
      db,
    );
    expect(imported.imported).toBe(5);
    const batchId = imported.batchId ?? "";

    // A manual transaction (batchId null) that must survive the undo.
    const manual = await createTransaction(
      {
        accountId,
        categoryId: null,
        date: "2026-06-15",
        description: "MANUAL CASH",
        amountCents: -1234,
      },
      db,
    );
    expect(manual.status).toBe("created");

    const result = await undoImport(batchId, db);
    expect(result).toEqual({ deletedCount: 5, filename: "june.csv" });

    // Only the manual row remains; the batch record is gone.
    const remaining = await db.select().from(transactions);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ description: "MANUAL CASH", batchId: null });
    expect((await getRecentImportBatches(50, db)).find((b) => b.id === batchId)).toBeUndefined();

    // Aggregates reflect only the surviving manual row.
    expect(await getNetWorth(db)).toBe(-1234);
  });

  it("undoing an already-undone (or unknown) batch returns null", async () => {
    const imported = await importStatement(
      { account: existingAccount(accountId), csvText: CSV, filename: "june.csv" },
      db,
    );
    const batchId = imported.batchId ?? "";
    expect(await undoImport(batchId, db)).toEqual({ deletedCount: 5, filename: "june.csv" });

    expect(await undoImport(batchId, db)).toBeNull();
    expect(await undoImport("does-not-exist", db)).toBeNull();
  });
});
