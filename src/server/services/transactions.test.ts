import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type Db } from "@/db/client";
import { setupTestDbPerTest } from "@/test/test-db";
import { accounts, importBatches, transactions, transactionSplits } from "@/db/schema";
import {
  createTransaction,
  deleteTransaction,
  getSplitMismatches,
  getSplitsForTransaction,
  getTransactionById,
  getTransactionsPage,
  parseTransactionQuery,
  parseTransactionPage,
  replaceSplits,
  setTransactionCleared,
  setTransactionSpendingExclusion,
  setTransactionCategory,
  transactionPageHref,
  transactionQuerySearchParams,
  type TransactionInput,
  updateTransaction,
} from "./transactions";
import { createAccount, getAccountsWithBalances, type CreateAccountInput } from "./accounts";
import { createCategory, type CategoryInput } from "./categories";
import {
  getBudgetVsActual,
  getMonthlySummary,
  getSpendingTrend,
} from "./summary";
import { MAX_SPLIT_PARTS } from "./write-validation";

async function mustCreateAccount(input: CreateAccountInput, db: Db) {
  const result = await createAccount(input, db);
  if (result.status !== "created") throw new Error(`account fixture failed: ${result.status}`);
  return result.account;
}

async function mustCreateCategory(input: CategoryInput, db: Db) {
  const result = await createCategory(input, db);
  if (result.status !== "created") throw new Error(`category fixture failed: ${result.status}`);
  return result.category;
}

async function mustCreateTransaction(input: TransactionInput, db: Db) {
  const result = await createTransaction(input, db);
  if (result.status !== "created") throw new Error(`transaction fixture failed: ${result.status}`);
  return result.transaction;
}

describe("transactions service (integration, temp DB)", () => {
  const ctx = setupTestDbPerTest("finance-txn-");
  let db: Db;
  let accountA: string;
  let accountB: string;
  let groceriesId: string;

  beforeEach(async () => {
    db = ctx.db;
    accountA = (await mustCreateAccount({ name: "A", type: "CHECKING", currency: "USD" }, db)).id;
    accountB = (await mustCreateAccount({ name: "B", type: "CREDIT_CARD", currency: "USD" }, db)).id;
    groceriesId = (
      await mustCreateCategory(
        { name: "Groceries", color: null, keywords: [], excludeFromSpending: false },
        db,
      )
    ).id;
    // fixture rows across months/accounts/categories
    for (let i = 1; i <= 60; i++) {
      await mustCreateTransaction(
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
    await mustCreateTransaction(
      {
        accountId: accountB,
        categoryId: groceriesId,
        date: "2026-06-10",
        description: "CORNER MARKET 100% JUICE",
        amountCents: -1234,
      },
      db,
    );
    await mustCreateTransaction(
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
    const row = await mustCreateTransaction(
      {
        accountId: accountA,
        categoryId: groceriesId,
        date: "2026-06-15",
        description: "MANUAL CASH BUY",
        amountCents: -750,
        notes: "  Met Sam\r\noutside  ",
        tags: ["Personal", "cash", "PERSONAL"],
      },
      db,
    );
    expect(row.importHash).toBeNull();
    expect(row.amountCents).toBe(-750);
    expect(row.notes).toBe("Met Sam\noutside");
    expect(row.tagsJson).toBe('["cash","personal"]');
  });

  it("stores merchant and row flags, filters cleared rows, and computes account running balances", async () => {
    const balanceAccount = await mustCreateAccount(
      {
        name: "Balance Account",
        type: "CHECKING",
        currency: "USD",
        openingBalanceCents: 1000,
      },
      db,
    );
    await db.insert(transactions).values([
      {
        id: "balance-early",
        accountId: balanceAccount.id,
        date: "2026-06-01",
        description: "EARLY",
        merchant: "Shop",
        amountCents: 200,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "balance-late",
        accountId: balanceAccount.id,
        date: "2026-06-02",
        description: "LATE",
        amountCents: -50,
        cleared: true,
        excludeFromSpending: true,
        createdAt: 2,
        updatedAt: 2,
      },
    ]);
    const page = await getTransactionsPage({ accountId: balanceAccount.id, requestedPage: 1 }, db);
    expect(page.items.map((row) => [row.description, row.runningBalanceCents])).toEqual([
      ["LATE", 1150],
      ["EARLY", 1200],
    ]);
    expect(page.items.find((row) => row.description === "EARLY")).toMatchObject({
      merchant: "Shop",
      cleared: false,
      excludeFromSpending: false,
    });
    expect((await getTransactionsPage({ accountId: balanceAccount.id, cleared: true, requestedPage: 1 }, db)).items)
      .toMatchObject([{ description: "LATE", cleared: true }]);
    expect(await setTransactionCleared("balance-early", true, db)).toMatchObject({ status: "updated" });
    expect(await setTransactionSpendingExclusion("balance-early", true, db)).toMatchObject({ status: "updated" });
    expect((await getTransactionsPage({ accountId: balanceAccount.id, cleared: true, requestedPage: 1 }, db)).totalCount)
      .toBe(2);
    expect(await getMonthlySummary("2026-06", db, [balanceAccount.id])).toMatchObject({
      incomeCents: 0,
      spendingCents: 0,
    });
  });

  it("keeps a top-level normalized-or-null currency on money-rendering rows", async () => {
    await db
      .update(accounts)
      .set({ currency: " eur " })
      .where(eq(accounts.id, accountB));
    const normalized = await getTransactionsPage({
      q: "CORNER MARKET",
      requestedPage: 1,
    }, db);
    expect(normalized.items[0]).toMatchObject({
      rawCurrency: " eur ",
      currency: " eur ",
      normalizedCurrency: "EUR",
      currencyState: { kind: "valid", currency: "EUR" },
    });

    await db
      .update(accounts)
      .set({ currency: "not-a-code" })
      .where(eq(accounts.id, accountB));
    const invalid = await getTransactionsPage({
      q: "CORNER MARKET",
      requestedPage: 1,
    }, db);
    expect(invalid.items[0]).toMatchObject({
      rawCurrency: "not-a-code",
      currency: "not-a-code",
      normalizedCurrency: null,
      currencyState: { kind: "invalid" },
    });
  });

  it("update changes every field; delete removes the row", async () => {
    const row = await mustCreateTransaction(
      {
        accountId: accountA,
        categoryId: null,
        date: "2026-06-16",
        description: "TO EDIT",
        amountCents: -100,
        notes: "Original note",
        tags: ["original"],
      },
      db,
    );
    expect(await updateTransaction(
      row.id,
      {
        accountId: accountB,
        categoryId: groceriesId,
        date: "2026-06-17",
        description: "EDITED",
        amountCents: 2500,
        notes: "Edited note",
        tags: ["Travel", "reviewed"],
      },
      db,
    )).toEqual({ status: "updated", id: row.id });
    const updated = await getTransactionById(row.id, db);
    expect(updated).toMatchObject({
      accountId: accountB,
      categoryId: groceriesId,
      date: "2026-06-17",
      description: "EDITED",
      amountCents: 2500,
      notes: "Edited note",
      tags: ["reviewed", "travel"],
    });
    expect(await deleteTransaction(row.id, db)).toBe(row.id);
    expect(await getTransactionById(row.id, db)).toBeNull();
  });

  it("preserves annotations when a legacy service caller omits them", async () => {
    const row = await mustCreateTransaction(
      {
        accountId: accountA,
        categoryId: null,
        date: "2026-06-16",
        description: "ANNOTATED LEGACY UPDATE",
        amountCents: -100,
        notes: "Keep this note",
        tags: ["keep", "reviewed"],
      },
      db,
    );

    await expect(
      updateTransaction(
        row.id,
        {
          accountId: accountA,
          categoryId: groceriesId,
          date: "2026-06-17",
          description: "LEGACY CALLER UPDATED",
          amountCents: -200,
        },
        db,
      ),
    ).resolves.toEqual({ status: "updated", id: row.id });
    expect(await getTransactionById(row.id, db)).toMatchObject({
      description: "LEGACY CALLER UPDATED",
      notes: "Keep this note",
      tags: ["keep", "reviewed"],
    });
  });

  it("balances include manual rows", async () => {
    await mustCreateTransaction(
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

  it("rejects invalid values and unknown references without writing", async () => {
    const beforeCount = (await db.select().from(transactions)).length;
    const base: TransactionInput = {
      accountId: accountA,
      categoryId: null,
      date: "2026-06-20",
      description: "DIRECT WRITE",
      amountCents: -100,
    };

    await expect(
      createTransaction({ ...base, date: "2026-02-30" }, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "date" });
    await expect(
      createTransaction({ ...base, amountCents: Number.MAX_SAFE_INTEGER + 1 }, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "amountCents" });
    await expect(
      createTransaction({ ...base, description: "   " }, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "description" });
    await expect(
      createTransaction({ ...base, notes: "x".repeat(2_001) }, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "notes" });
    await expect(
      createTransaction({ ...base, tags: ["comma,inside"] }, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "tags" });
    await expect(
      createTransaction({ ...base, accountId: "missing-account" }, db),
    ).resolves.toEqual({ status: "unknown-account" });
    await expect(
      createTransaction({ ...base, categoryId: "missing-category" }, db),
    ).resolves.toEqual({ status: "unknown-category" });
    expect(await db.select().from(transactions)).toHaveLength(beforeCount);
  });

  it("returns typed update and recategorization failures without changing the row", async () => {
    const row = await mustCreateTransaction(
      {
        accountId: accountA,
        categoryId: null,
        date: "2026-06-21",
        description: "UNCHANGED",
        amountCents: -200,
      },
      db,
    );
    const before = await getTransactionById(row.id, db);

    await expect(
      updateTransaction(row.id, { ...row, categoryId: "missing-category" }, db),
    ).resolves.toEqual({ status: "unknown-category" });
    await expect(
      updateTransaction("missing-transaction", {
        accountId: accountA,
        categoryId: null,
        date: "2026-06-21",
        description: "NO ROW",
        amountCents: 1,
      }, db),
    ).resolves.toEqual({ status: "not-found" });
    await expect(
      setTransactionCategory(row.id, "missing-category", db),
    ).resolves.toEqual({ status: "unknown-category" });
    expect(await getTransactionById(row.id, db)).toEqual(before);
  });

  it("paginates with a correct total count", async () => {
    const page1 = await getTransactionsPage({ requestedPage: 1 }, db);
    const page2 = await getTransactionsPage({ requestedPage: 2 }, db);
    const clamped = await getTransactionsPage({ requestedPage: 999 }, db);
    expect(page1.totalCount).toBeGreaterThanOrEqual(62);
    expect(page1.items).toHaveLength(50);
    expect(page1).toMatchObject({ page: 1, lastPage: 2 });
    expect(page2.totalCount).toBe(page1.totalCount);
    expect(page2.items.length).toBe(page1.totalCount - 50);
    expect(page2).toMatchObject({ page: 2, lastPage: 2 });
    expect(clamped).toMatchObject({ page: 2, lastPage: 2, totalCount: page1.totalCount });
    expect(clamped.items.map((row) => row.id)).toEqual(page2.items.map((row) => row.id));
    // no overlap between pages
    const ids1 = new Set(page1.items.map((t) => t.id));
    expect(page2.items.every((t) => !ids1.has(t.id))).toBe(true);
  });

  it.each([
    "",
    "0",
    "-1",
    "+1",
    "01",
    "1.5",
    "1e2",
    "Infinity",
    "9007199254740992",
    "9".repeat(1000),
  ])("canonicalizes unsafe page text %j to page 1", (raw) => {
    expect(parseTransactionPage(raw)).toEqual({
      requestedPage: 1,
      needsCanonicalRedirect: true,
    });
  });

  it("accepts only absent or positive safe-integer page values", () => {
    expect(parseTransactionPage(undefined)).toEqual({
      requestedPage: 1,
      needsCanonicalRedirect: false,
    });
    expect(parseTransactionPage("1")).toEqual({
      requestedPage: 1,
      needsCanonicalRedirect: false,
    });
    expect(parseTransactionPage("9007199254740991")).toEqual({
      requestedPage: Number.MAX_SAFE_INTEGER,
      needsCanonicalRedirect: false,
    });
  });

  it("builds canonical page and export URLs without a page-1 redirect loop", () => {
    const query = {
      q: "rent & utilities",
      tag: "shared trip",
      accountId: "account/id",
      categoryId: null,
      month: "2026-06",
      from: "2026-06-02",
      to: "2026-06-20",
    } as const;
    const pageOne = transactionPageHref(query, 1);
    expect(pageOne).toBe(
      "/transactions?q=rent+%26+utilities&tag=shared+trip&account=account%2Fid&category=uncategorized&month=2026-06&from=2026-06-02&to=2026-06-20",
    );
    expect(pageOne).not.toContain("page=");
    expect(transactionPageHref(query, 2)).toBe(`${pageOne}&page=2`);
    expect(transactionQuerySearchParams(query).toString()).toBe(pageOne.split("?")[1]);
    expect(parseTransactionPage(undefined).needsCanonicalRedirect).toBe(false);
    expect(() => transactionPageHref(query, 0)).toThrow(RangeError);
  });

  it("canonicalizes one exact tag query and drops malformed tag input", () => {
    expect(parseTransactionQuery((key) => (key === "tag" ? "  Summer   Trip  " : undefined)))
      .toMatchObject({ tag: "summer trip" });
    expect(parseTransactionQuery((key) => (key === "tag" ? "two,tags" : undefined)).tag)
      .toBeUndefined();
    expect(parseTransactionQuery((key) => (key === "tag" ? "bad\0tag" : undefined)).tag)
      .toBeUndefined();
  });

  it("rejects invalid direct service page numbers before calculating an offset", async () => {
    await expect(getTransactionsPage({ requestedPage: 0 }, db)).rejects.toThrow(RangeError);
    await expect(
      getTransactionsPage({ requestedPage: Number.MAX_SAFE_INTEGER + 1 }, db),
    ).rejects.toThrow(RangeError);
  });

  it("searches descriptions case-insensitively with literal wildcards", async () => {
    const search = await getTransactionsPage({ q: "corner market", requestedPage: 1 }, db);
    expect(search.totalCount).toBe(1);
    expect(search.items[0]?.description).toBe("CORNER MARKET 100% JUICE");
    // literal % and _ must not act as wildcards
    const percent = await getTransactionsPage({ q: "100%", requestedPage: 1 }, db);
    expect(percent.totalCount).toBe(1);
    const underscore = await getTransactionsPage({ q: "under_score", requestedPage: 1 }, db);
    expect(underscore.totalCount).toBe(1);
    const noWildcard = await getTransactionsPage({ q: "under.score", requestedPage: 1 }, db);
    expect(noWildcard.totalCount).toBe(0);
  });

  it("searches annotations and filters one exact canonical tag without duplicate rows", async () => {
    const annotated = await mustCreateTransaction(
      {
        accountId: accountA,
        categoryId: null,
        date: "2026-06-18",
        description: "GENERIC MERCHANT",
        amountCents: -900,
        notes: "Shared with Rowan at the lake 100%",
        tags: ["Summer Trip", "under_score"],
      },
      db,
    );

    const byNote = await getTransactionsPage({ q: "rowan", requestedPage: 1 }, db);
    expect(byNote.items).toHaveLength(1);
    expect(byNote.items[0]).toMatchObject({
      id: annotated.id,
      notes: "Shared with Rowan at the lake 100%",
      tags: ["summer trip", "under_score"],
    });
    expect((await getTransactionsPage({ q: "100%", requestedPage: 1 }, db)).totalCount).toBe(2);
    expect((await getTransactionsPage({ q: "under_score", requestedPage: 1 }, db)).totalCount).toBe(2);
    expect((await getTransactionsPage({ q: "under.score", requestedPage: 1 }, db)).totalCount).toBe(0);
    expect((await getTransactionsPage({ q: "[", requestedPage: 1 }, db)).totalCount).toBe(0);

    const byTag = await getTransactionsPage(
      { tag: "summer trip", requestedPage: 1 },
      db,
    );
    expect(byTag.items.map((row) => row.id)).toEqual([annotated.id]);
  });

  it("tolerates malformed historical tag JSON without treating object values as tags", async () => {
    const row = await mustCreateTransaction(
      {
        accountId: accountA,
        categoryId: null,
        date: "2026-06-19",
        description: "MALFORMED TAG FIXTURE",
        amountCents: -1,
      },
      db,
    );
    await db
      .update(transactions)
      .set({ tagsJson: '{"unexpected":"work"}' })
      .where(eq(transactions.id, row.id));

    const page = await getTransactionsPage({ q: "MALFORMED TAG", requestedPage: 1 }, db);
    expect(page.items[0]).toMatchObject({ id: row.id, tags: [] });
    expect((await getTransactionsPage({ tag: "work", requestedPage: 1 }, db)).totalCount)
      .toBe(0);

    await db
      .update(transactions)
      .set({ tagsJson: "not-json" })
      .where(eq(transactions.id, row.id));
    await expect(
      getTransactionsPage({ tag: "work", requestedPage: 1 }, db),
    ).resolves.toMatchObject({ totalCount: 0 });
    await expect(
      getTransactionsPage({ q: "work", requestedPage: 1 }, db),
    ).resolves.toMatchObject({ totalCount: 0 });
  });

  it("filters by account, category (incl. uncategorized), and month; filters AND together", async () => {
    const byAccount = await getTransactionsPage({ accountId: accountB, requestedPage: 1 }, db);
    expect(byAccount.totalCount).toBe(1);

    const uncategorized = await getTransactionsPage(
      { categoryId: null, month: "2026-06", requestedPage: 1 },
      db,
    );
    expect(uncategorized.totalCount).toBe(1);
    expect(uncategorized.items[0]?.description).toBe("under_score merchant");

    const may = await getTransactionsPage({ month: "2026-05", requestedPage: 1 }, db);
    expect(may.totalCount).toBe(60);

    const combined = await getTransactionsPage(
      { q: "BULK", accountId: accountA, month: "2026-06", requestedPage: 1 },
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
    accountId = (await mustCreateAccount({ name: "SplitAcct", type: "CHECKING", currency: "USD" }, db)).id;
    catA = (await mustCreateCategory({ name: "CatA", color: null, keywords: [], excludeFromSpending: false, monthlyBudgetCents: 6000 }, db)).id;
    catB = (await mustCreateCategory({ name: "CatB", color: null, keywords: [], excludeFromSpending: false }, db)).id;
    txId = (
      await mustCreateTransaction(
        { accountId, categoryId: null, date: "2026-06-10", description: "SPLIT ME", amountCents: -10000 },
        db,
      )
    ).id;
  });

  it("reports clearing an already-unsplit transaction as unchanged", async () => {
    await expect(replaceSplits(txId, [], db)).resolves.toEqual({ status: "unchanged" });
    await expect(getSplitsForTransaction(txId, db)).resolves.toEqual([]);
  });

  it("replaceSplits persists parts that getSplitsForTransaction reads back", async () => {
    expect(await replaceSplits(
      txId,
      [
        { categoryId: catA, amountCents: -6000 },
        { categoryId: catB, amountCents: -4000 },
      ],
      db,
    )).toEqual({ status: "updated" });
    const splits = await getSplitsForTransaction(txId, db);
    expect(splits).toHaveLength(2);
    expect(splits.reduce((a, s) => a + s.amountCents, 0)).toBe(-10000);
  });

  it("persists exactly the bounded maximum number of split parts", async () => {
    const parts = Array.from({ length: MAX_SPLIT_PARTS }, () => ({
      categoryId: catA,
      amountCents: -40,
    }));
    expect(await replaceSplits(txId, parts, db)).toEqual({ status: "updated" });
    expect(await getSplitsForTransaction(txId, db)).toHaveLength(MAX_SPLIT_PARTS);
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
    const { items } = await getTransactionsPage({ q: "SPLIT ME", requestedPage: 1 }, db);
    expect(items[0]?.isSplit).toBe(true);
  });

  it("replaceSplits replaces rather than appends; empty parts clear the split", async () => {
    await expect(setTransactionCategory(txId, catA, db)).resolves.toEqual({
      status: "updated",
      id: txId,
    });
    await replaceSplits(
      txId,
      [
        { categoryId: catA, amountCents: -6000 },
        { categoryId: catB, amountCents: -4000 },
      ],
      db,
    );
    await replaceSplits(
      txId,
      [
        { categoryId: catA, amountCents: -7000 },
        { categoryId: catB, amountCents: -3000 },
      ],
      db,
    );
    expect(
      (await getSplitsForTransaction(txId, db))
        .map((part) => part.amountCents)
        .sort((left, right) => left - right),
    ).toEqual([-7000, -3000]);
    await replaceSplits(txId, [], db);
    expect(await getSplitsForTransaction(txId, db)).toHaveLength(0);
    const { items } = await getTransactionsPage({ q: "SPLIT ME", requestedPage: 1 }, db);
    expect(items[0]?.isSplit).toBe(false);
    expect(items[0]?.categoryId).toBe(catA);
  });

  it("supports positive split totals", async () => {
    const income = await mustCreateTransaction(
      {
        accountId,
        categoryId: null,
        date: "2026-06-11",
        description: "SPLIT INCOME",
        amountCents: 10000,
      },
      db,
    );
    await expect(
      replaceSplits(
        income.id,
        [
          { categoryId: catA, amountCents: 6000 },
          { categoryId: catB, amountCents: 4000 },
        ],
        db,
      ),
    ).resolves.toEqual({ status: "updated" });
  });

  it("rejects invalid parts and unknown references without replacing existing parts", async () => {
    expect(
      await replaceSplits(
        txId,
        [
          { categoryId: catA, amountCents: -6000 },
          { categoryId: catB, amountCents: -4000 },
        ],
        db,
      ),
    ).toEqual({ status: "updated" });
    const before = await getSplitsForTransaction(txId, db);

    await expect(
      replaceSplits(
        txId,
        [{ categoryId: catA, amountCents: Number.MAX_SAFE_INTEGER + 1 }],
        db,
      ),
    ).resolves.toMatchObject({ status: "invalid-input", field: "amountCents" });
    await expect(
      replaceSplits(
        txId,
        Array.from({ length: MAX_SPLIT_PARTS + 1 }, () => ({
          categoryId: catA,
          amountCents: -1,
        })),
        db,
      ),
    ).resolves.toMatchObject({ status: "invalid-input", field: "parts" });
    await expect(
      replaceSplits(txId, [{ categoryId: catA, amountCents: -10000 }], db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "parts" });
    await expect(
      replaceSplits(
        txId,
        [
          { categoryId: catA, amountCents: -10000 },
          { categoryId: catB, amountCents: 0 },
        ],
        db,
      ),
    ).resolves.toMatchObject({ status: "invalid-input", field: "amountCents" });
    await expect(
      replaceSplits(
        txId,
        [
          { categoryId: catA, amountCents: Number.MAX_SAFE_INTEGER },
          { categoryId: catB, amountCents: 1 },
        ],
        db,
      ),
    ).resolves.toMatchObject({ status: "invalid-input", field: "parts" });
    await expect(
      replaceSplits(
        txId,
        [
          { categoryId: catA, amountCents: -5000 },
          { categoryId: catB, amountCents: -4000 },
        ],
        db,
      ),
    ).resolves.toEqual({
      status: "split-total-mismatch",
      parentAmountCents: -10000,
      splitTotalCents: -9000,
    });
    await expect(
      replaceSplits(
        txId,
        [
          { categoryId: "missing-category", amountCents: -6000 },
          { categoryId: catB, amountCents: -4000 },
        ],
        db,
      ),
    ).resolves.toEqual({ status: "unknown-category" });
    await expect(
      replaceSplits(
        "missing-transaction",
        [
          { categoryId: catA, amountCents: -6000 },
          { categoryId: catB, amountCents: -4000 },
        ],
        db,
      ),
    ).resolves.toEqual({ status: "not-found" });
    expect(await getSplitsForTransaction(txId, db)).toEqual(before);
  });

  it("rolls back the delete when a replacement insert fails", async () => {
    await replaceSplits(
      txId,
      [
        { categoryId: catA, amountCents: -6000 },
        { categoryId: catB, amountCents: -4000 },
      ],
      db,
    );
    const before = await getSplitsForTransaction(txId, db);
    db.run(sql.raw(`
      create trigger synthetic_split_insert_failure
      before insert on transaction_splits
      begin
        select raise(abort, 'synthetic split insert failure');
      end
    `));

    await expect(
      replaceSplits(
        txId,
        [
          { categoryId: catA, amountCents: -7000 },
          { categoryId: catB, amountCents: -3000 },
        ],
        db,
      ),
    ).rejects.toThrow("synthetic split insert failure");
    expect(await getSplitsForTransaction(txId, db)).toEqual(before);
  });

  it("allows metadata edits on a valid split, blocks amount edits, and preserves provenance", async () => {
    await db.insert(importBatches).values({
      id: "batch-1",
      accountId,
      filename: "synthetic.csv",
      importedCount: 1,
      skippedCount: 0,
    });
    await db
      .update(transactions)
      .set({ importHash: "synthetic-import-hash", batchId: "batch-1" })
      .where(eq(transactions.id, txId));
    await replaceSplits(
      txId,
      [
        { categoryId: catA, amountCents: -6000 },
        { categoryId: catB, amountCents: -4000 },
      ],
      db,
    );
    const beforeParts = await getSplitsForTransaction(txId, db);

    await expect(
      updateTransaction(
        txId,
        {
          accountId,
          categoryId: null,
          date: "2026-06-10",
          description: "AMOUNT EDIT REFUSED",
          amountCents: -12000,
        },
        db,
      ),
    ).resolves.toEqual({
      status: "split-amount-conflict",
      currentAmountCents: -10000,
      splitTotalCents: -10000,
    });

    const secondAccount = await mustCreateAccount(
      { name: "SplitAcct2", type: "CHECKING", currency: "USD" },
      db,
    );
    await expect(
      updateTransaction(
        txId,
        {
          accountId: secondAccount.id,
          categoryId: catA,
          date: "2026-06-12",
          description: "METADATA EDITED",
          amountCents: -10000,
          notes: "Shared household purchase",
          tags: ["split", "reviewed"],
        },
        db,
      ),
    ).resolves.toEqual({ status: "updated", id: txId });

    expect(await getTransactionById(txId, db)).toMatchObject({
      accountId: secondAccount.id,
      categoryId: catA,
      date: "2026-06-12",
      description: "METADATA EDITED",
      amountCents: -10000,
      notes: "Shared household purchase",
      tags: ["reviewed", "split"],
      importHash: "synthetic-import-hash",
      batchId: "batch-1",
    });
    expect(await getSplitsForTransaction(txId, db)).toEqual(beforeParts);
  });

  it("reports historical mismatches and blocks every ordinary parent edit", async () => {
    await db.insert(transactions).values({
      id: "unsafe-split-total",
      accountId,
      categoryId: null,
      date: "2026-06-09",
      description: "UNSAFE HISTORICAL TOTAL",
      amountCents: -1,
    });
    await db.insert(transactionSplits).values([
      { transactionId: txId, categoryId: catA, amountCents: -6000 },
      { transactionId: txId, categoryId: catB, amountCents: -3000 },
      {
        transactionId: "unsafe-split-total",
        categoryId: catA,
        amountCents: Number.MAX_SAFE_INTEGER,
      },
      { transactionId: "unsafe-split-total", categoryId: catB, amountCents: 1 },
    ]);
    const beforeParent = await getTransactionById(txId, db);
    const beforeParts = await getSplitsForTransaction(txId, db);

    await expect(getSplitMismatches(db)).resolves.toContainEqual({
      transactionId: txId,
      parentAmountCents: -10000,
      splitTotalCents: -9000,
    });
    await expect(getSplitMismatches(db)).resolves.toContainEqual({
      transactionId: "unsafe-split-total",
      parentAmountCents: -1,
      splitTotalCents: null,
    });
    await expect(
      updateTransaction(
        txId,
        {
          accountId,
          categoryId: catA,
          date: "2026-06-20",
          description: "MUST NOT CHANGE",
          amountCents: -10000,
        },
        db,
      ),
    ).resolves.toEqual({
      status: "existing-split-mismatch",
      parentAmountCents: -10000,
      splitTotalCents: -9000,
    });
    await expect(setTransactionCategory(txId, catA, db)).resolves.toEqual({
      status: "existing-split-mismatch",
      parentAmountCents: -10000,
      splitTotalCents: -9000,
    });
    expect(await getTransactionById(txId, db)).toEqual(beforeParent);
    expect(await getSplitsForTransaction(txId, db)).toEqual(beforeParts);
  });

  it("keeps balances, spending, budgets, and trends aligned after permitted mutations", async () => {
    await replaceSplits(
      txId,
      [
        { categoryId: catA, amountCents: -6000 },
        { categoryId: catB, amountCents: -4000 },
      ],
      db,
    );
    expect((await getAccountsWithBalances(db)).find((row) => row.id === accountId)?.balanceCents)
      .toBe(-10000);
    await expect(getMonthlySummary("2026-06", db)).resolves.toMatchObject({
      spendingCents: 10000,
    });
    expect((await getBudgetVsActual("2026-06", db)).find((row) => row.categoryId === catA))
      .toMatchObject({ spentCents: 6000 });
    await expect(getSpendingTrend("2026-06", 1, db)).resolves.toEqual([
      { month: "2026-06", incomeCents: 0, spendingCents: 10000 },
    ]);

    await expect(replaceSplits(txId, [], db)).resolves.toEqual({ status: "updated" });
    await expect(getMonthlySummary("2026-06", db)).resolves.toMatchObject({
      spendingCents: 10000,
    });
    expect((await getBudgetVsActual("2026-06", db)).find((row) => row.categoryId === catA))
      .toMatchObject({ spentCents: 0 });
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

describe("split writes across two real SQLite connections", () => {
  it("serializes competing parent and split writes without committing a mismatch", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "finance-split-race-"));
    const file = path.join(dir, "race.db");
    const first = createTestDb(file);
    const second = createTestDb(file);
    first.sqlite.pragma("busy_timeout = 0");
    second.sqlite.pragma("busy_timeout = 0");

    try {
      const account = await mustCreateAccount(
        { name: "Race Account", type: "CHECKING", currency: "USD" },
        first.db,
      );
      const categoryA = await mustCreateCategory(
        { name: "Race A", color: null, keywords: [], excludeFromSpending: false },
        first.db,
      );
      const categoryB = await mustCreateCategory(
        { name: "Race B", color: null, keywords: [], excludeFromSpending: false },
        first.db,
      );
      const parts = [
        { categoryId: categoryA.id, amountCents: -6000 },
        { categoryId: categoryB.id, amountCents: -4000 },
      ];

      const updateWins = await mustCreateTransaction(
        {
          accountId: account.id,
          categoryId: null,
          date: "2026-06-20",
          description: "UPDATE WINS",
          amountCents: -10000,
        },
        first.db,
      );
      let updateWinner: ReturnType<typeof updateTransaction> | undefined;
      let splitLoser: ReturnType<typeof replaceSplits> | undefined;
      first.db.transaction(
        (tx) => {
          updateWinner = updateTransaction(
            updateWins.id,
            { ...updateWins, description: "UPDATE WON", amountCents: -12000 },
            tx,
          );
          splitLoser = replaceSplits(updateWins.id, parts, second.db);
        },
        { behavior: "immediate" },
      );
      if (!updateWinner || !splitLoser) throw new Error("race schedule did not execute");
      await expect(updateWinner).resolves.toEqual({ status: "updated", id: updateWins.id });
      await expect(splitLoser).rejects.toMatchObject({ code: "SQLITE_BUSY" });
      await expect(replaceSplits(updateWins.id, parts, second.db)).resolves.toEqual({
        status: "split-total-mismatch",
        parentAmountCents: -12000,
        splitTotalCents: -10000,
      });
      expect(await getSplitsForTransaction(updateWins.id, first.db)).toHaveLength(0);
      expect((await getTransactionById(updateWins.id, first.db))?.amountCents).toBe(-12000);

      const splitWins = await mustCreateTransaction(
        {
          accountId: account.id,
          categoryId: null,
          date: "2026-06-21",
          description: "SPLIT WINS",
          amountCents: -10000,
        },
        first.db,
      );
      let splitWinner: ReturnType<typeof replaceSplits> | undefined;
      let updateLoser: ReturnType<typeof updateTransaction> | undefined;
      first.db.transaction(
        (tx) => {
          splitWinner = replaceSplits(splitWins.id, parts, tx);
          updateLoser = updateTransaction(
            splitWins.id,
            { ...splitWins, description: "UPDATE LOST", amountCents: -12000 },
            second.db,
          );
        },
        { behavior: "immediate" },
      );
      if (!splitWinner || !updateLoser) throw new Error("reverse race schedule did not execute");
      await expect(splitWinner).resolves.toEqual({ status: "updated" });
      await expect(updateLoser).rejects.toMatchObject({ code: "SQLITE_BUSY" });
      await expect(
        updateTransaction(
          splitWins.id,
          { ...splitWins, description: "RETRY", amountCents: -12000 },
          second.db,
        ),
      ).resolves.toEqual({
        status: "split-amount-conflict",
        currentAmountCents: -10000,
        splitTotalCents: -10000,
      });
      const finalParent = await getTransactionById(splitWins.id, first.db);
      const finalParts = await getSplitsForTransaction(splitWins.id, first.db);
      expect(finalParent?.amountCents).toBe(-10000);
      expect(finalParts.reduce((total, part) => total + part.amountCents, 0)).toBe(-10000);
    } finally {
      second.sqlite.close();
      first.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
