import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { type Db } from "@/db/client";
import { setupTestDbPerTest } from "@/test/test-db";
import { categories, transactions } from "@/db/schema";
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
    const { account } = await getOrCreateAccountByName("Test Checking", "CHECKING", db);
    accountId = account.id;
  });

  it("imports all rows including same-day identical ones, auto-categorized", async () => {
    const result = await importStatement({ accountId, csvText: CSV }, db);
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
    const first = await importStatement({ accountId, csvText: CSV }, db);
    expect(first.imported).toBe(5);

    const result = await importStatement({ accountId, csvText: CSV }, db);
    expect(result.imported).toBe(0);
    expect(result.skipped).toHaveLength(5);
    expect(result.skipped[0]).toMatchObject({ description: "ACME PAYROLL" });
  });

  it("balances reflect opening balance plus imported rows", async () => {
    const result = await importStatement({ accountId, csvText: CSV }, db);
    expect(result.imported).toBe(5);

    const [account] = await getAccountsWithBalances(db);
    expect(account?.balanceCents).toBe(260000 - 7812 - 450 - 450 - 70000);
    expect(await getNetWorth(db)).toBe(account?.balanceCents);
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
    const { account } = await getOrCreateAccountByName("Batch Checking", "CHECKING", db);
    accountId = account.id;
  });

  it("records a batch with counts + filename and stamps every imported row", async () => {
    const result = await importStatement({ accountId, csvText: CSV, filename: "june.csv" }, db);
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
      { accountId, csvText: CSV, filename: "june.csv" },
      db,
    );
    expect(first.imported).toBe(5);

    const before = await getRecentImportBatches(50, db);
    const result = await importStatement({ accountId, csvText: CSV, filename: "june.csv" }, db);
    expect(result.imported).toBe(0);
    expect(result.batchId).toBeNull();
    const after = await getRecentImportBatches(50, db);
    expect(after).toHaveLength(before.length);
  });

  it("undo deletes exactly the batch's rows and leaves manual rows untouched", async () => {
    const imported = await importStatement(
      { accountId, csvText: CSV, filename: "june.csv" },
      db,
    );
    expect(imported.imported).toBe(5);
    const batchId = imported.batchId ?? "";

    // A manual transaction (batchId null) that must survive the undo.
    await createTransaction(
      {
        accountId,
        categoryId: null,
        date: "2026-06-15",
        description: "MANUAL CASH",
        amountCents: -1234,
      },
      db,
    );

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
      { accountId, csvText: CSV, filename: "june.csv" },
      db,
    );
    const batchId = imported.batchId ?? "";
    expect(await undoImport(batchId, db)).toEqual({ deletedCount: 5, filename: "june.csv" });

    expect(await undoImport(batchId, db)).toBeNull();
    expect(await undoImport("does-not-exist", db)).toBeNull();
  });
});
