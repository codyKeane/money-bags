import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/db/client";
import { categories } from "@/db/schema";
import { importStatement } from "./import";
import { getAccountsWithBalances, getNetWorth, getOrCreateAccountByName } from "./accounts";
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
  let dir: string;
  let db: Db;
  let sqlite: { close(): void };
  let accountId: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "finance-test-"));
    const handle = createTestDb(path.join(dir, "test.db"));
    db = handle.db;
    sqlite = handle.sqlite;
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

  afterAll(() => {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
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
    const result = await importStatement({ accountId, csvText: CSV }, db);
    expect(result.imported).toBe(0);
    expect(result.skipped).toHaveLength(5);
    expect(result.skipped[0]).toMatchObject({ description: "ACME PAYROLL" });
  });

  it("balances reflect opening balance plus imported rows", async () => {
    const [account] = await getAccountsWithBalances(db);
    expect(account?.balanceCents).toBe(260000 - 7812 - 450 - 450 - 70000);
    expect(await getNetWorth(db)).toBe(account?.balanceCents);
  });
});
