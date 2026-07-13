import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { type Db } from "@/db/client";
import { setupTestDbPerTest } from "@/test/test-db";
import { transactionSplits } from "@/db/schema";
import {
  createTransaction,
  deleteTransaction,
  getSplitsForTransaction,
  getTransactionById,
  getTransactionsPage,
  replaceSplits,
  updateTransaction,
} from "./transactions";
import { createAccount, getAccountsWithBalances } from "./accounts";
import { createCategory } from "./categories";

describe("transactions service (integration, temp DB)", () => {
  const ctx = setupTestDbPerTest("finance-txn-");
  let db: Db;
  let accountA: string;
  let accountB: string;
  let groceriesId: string;

  beforeEach(async () => {
    db = ctx.db;
    accountA = (await createAccount({ name: "A", type: "CHECKING" }, db)).id;
    accountB = (await createAccount({ name: "B", type: "CREDIT_CARD" }, db)).id;
    groceriesId = (
      await createCategory(
        { name: "Groceries", color: null, keywords: [], excludeFromSpending: false },
        db,
      )
    ).id;
    // fixture rows across months/accounts/categories
    for (let i = 1; i <= 60; i++) {
      await createTransaction(
        {
          accountId: accountA,
          categoryId: null,
          date: `2026-05-${String((i % 28) + 1).padStart(2, "0")}`,
          description: `BULK ROW ${i}`,
          amountCents: -100 * i,
        },
        db,
      );
    }
    await createTransaction(
      {
        accountId: accountB,
        categoryId: groceriesId,
        date: "2026-06-10",
        description: "CORNER MARKET 100% JUICE",
        amountCents: -1234,
      },
      db,
    );
    await createTransaction(
      {
        accountId: accountA,
        categoryId: null,
        date: "2026-06-11",
        description: "under_score merchant",
        amountCents: -500,
      },
      db,
    );
  });

  it("manual create stores signed cents with a null importHash", async () => {
    const row = await createTransaction(
      {
        accountId: accountA,
        categoryId: groceriesId,
        date: "2026-06-15",
        description: "MANUAL CASH BUY",
        amountCents: -750,
      },
      db,
    );
    expect(row.importHash).toBeNull();
    expect(row.amountCents).toBe(-750);
  });

  it("update changes every field; delete removes the row", async () => {
    const row = await createTransaction(
      {
        accountId: accountA,
        categoryId: null,
        date: "2026-06-16",
        description: "TO EDIT",
        amountCents: -100,
      },
      db,
    );
    await updateTransaction(
      row.id,
      {
        accountId: accountB,
        categoryId: groceriesId,
        date: "2026-06-17",
        description: "EDITED",
        amountCents: 2500,
      },
      db,
    );
    const updated = await getTransactionById(row.id, db);
    expect(updated).toMatchObject({
      accountId: accountB,
      categoryId: groceriesId,
      date: "2026-06-17",
      description: "EDITED",
      amountCents: 2500,
    });
    expect(await deleteTransaction(row.id, db)).toBe(row.id);
    expect(await getTransactionById(row.id, db)).toBeNull();
  });

  it("balances include manual rows", async () => {
    await createTransaction(
      {
        accountId: accountA,
        categoryId: null,
        date: "2026-06-15",
        description: "MANUAL BALANCE ROW",
        amountCents: -750,
      },
      db,
    );
    const rows = await getAccountsWithBalances(db);
    const a = rows.find((r) => r.id === accountA);
    expect(a?.transactionCount).toBe(62);
  });

  it("paginates with a correct total count", async () => {
    const page1 = await getTransactionsPage({ limit: 50, offset: 0 }, db);
    const page2 = await getTransactionsPage({ limit: 50, offset: 50 }, db);
    expect(page1.totalCount).toBeGreaterThanOrEqual(62);
    expect(page1.items).toHaveLength(50);
    expect(page2.totalCount).toBe(page1.totalCount);
    expect(page2.items.length).toBe(page1.totalCount - 50);
    // no overlap between pages
    const ids1 = new Set(page1.items.map((t) => t.id));
    expect(page2.items.every((t) => !ids1.has(t.id))).toBe(true);
  });

  it("searches descriptions case-insensitively with literal wildcards", async () => {
    const search = await getTransactionsPage({ q: "corner market", limit: 10, offset: 0 }, db);
    expect(search.totalCount).toBe(1);
    expect(search.items[0]?.description).toBe("CORNER MARKET 100% JUICE");
    // literal % and _ must not act as wildcards
    const percent = await getTransactionsPage({ q: "100%", limit: 10, offset: 0 }, db);
    expect(percent.totalCount).toBe(1);
    const underscore = await getTransactionsPage({ q: "under_score", limit: 10, offset: 0 }, db);
    expect(underscore.totalCount).toBe(1);
    const noWildcard = await getTransactionsPage({ q: "under.score", limit: 10, offset: 0 }, db);
    expect(noWildcard.totalCount).toBe(0);
  });

  it("filters by account, category (incl. uncategorized), and month; filters AND together", async () => {
    const byAccount = await getTransactionsPage({ accountId: accountB, limit: 10, offset: 0 }, db);
    expect(byAccount.totalCount).toBe(1);

    const uncategorized = await getTransactionsPage(
      { categoryId: null, month: "2026-06", limit: 10, offset: 0 },
      db,
    );
    expect(uncategorized.totalCount).toBe(1);
    expect(uncategorized.items[0]?.description).toBe("under_score merchant");

    const may = await getTransactionsPage({ month: "2026-05", limit: 100, offset: 0 }, db);
    expect(may.totalCount).toBe(60);

    const combined = await getTransactionsPage(
      { q: "BULK", accountId: accountA, month: "2026-06", limit: 10, offset: 0 },
      db,
    );
    expect(combined.totalCount).toBe(0);
  });
});

describe("transaction splits service (integration, temp DB)", () => {
  const ctx = setupTestDbPerTest("finance-splits-");
  let db: Db;
  let accountId: string;
  let catA: string;
  let catB: string;
  let txId: string;

  beforeEach(async () => {
    db = ctx.db;
    accountId = (await createAccount({ name: "SplitAcct", type: "CHECKING" }, db)).id;
    catA = (await createCategory({ name: "CatA", color: null, keywords: [], excludeFromSpending: false }, db)).id;
    catB = (await createCategory({ name: "CatB", color: null, keywords: [], excludeFromSpending: false }, db)).id;
    txId = (
      await createTransaction(
        { accountId, categoryId: null, date: "2026-06-10", description: "SPLIT ME", amountCents: -10000 },
        db,
      )
    ).id;
  });

  it("replaceSplits persists parts that getSplitsForTransaction reads back", async () => {
    await replaceSplits(
      txId,
      [
        { categoryId: catA, amountCents: -6000 },
        { categoryId: catB, amountCents: -4000 },
      ],
      db,
    );
    const splits = await getSplitsForTransaction(txId, db);
    expect(splits).toHaveLength(2);
    expect(splits.reduce((a, s) => a + s.amountCents, 0)).toBe(-10000);
  });

  it("flags the row as split in the transaction list", async () => {
    await replaceSplits(
      txId,
      [
        { categoryId: catA, amountCents: -6000 },
        { categoryId: catB, amountCents: -4000 },
      ],
      db,
    );
    const { items } = await getTransactionsPage({ q: "SPLIT ME", limit: 10, offset: 0 }, db);
    expect(items[0]?.isSplit).toBe(true);
  });

  it("replaceSplits replaces rather than appends; empty parts clear the split", async () => {
    await replaceSplits(
      txId,
      [
        { categoryId: catA, amountCents: -6000 },
        { categoryId: catB, amountCents: -4000 },
      ],
      db,
    );
    await replaceSplits(txId, [{ categoryId: catA, amountCents: -10000 }], db);
    expect(await getSplitsForTransaction(txId, db)).toHaveLength(1); // replaced, not 3
    await replaceSplits(txId, [], db);
    expect(await getSplitsForTransaction(txId, db)).toHaveLength(0);
    const { items } = await getTransactionsPage({ q: "SPLIT ME", limit: 10, offset: 0 }, db);
    expect(items[0]?.isSplit).toBe(false);
  });

  it("deleting the transaction cascades to its splits", async () => {
    await replaceSplits(
      txId,
      [
        { categoryId: catA, amountCents: -6000 },
        { categoryId: catB, amountCents: -4000 },
      ],
      db,
    );
    await deleteTransaction(txId, db);
    const remaining = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, txId));
    expect(remaining).toHaveLength(0);
  });
});
