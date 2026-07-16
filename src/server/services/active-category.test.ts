import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, categories, transactions, transactionSplits } from "@/db/schema";
import { setupTestDbPerTest } from "@/test/test-db";
import {
  applyRulesToUncategorized,
  deleteCategory,
  getCategoriesWithStats,
} from "./categories";
import { transactionMatchesActiveCategory } from "./active-category";
import { getTransactionsPage, getUncategorizedTransactionCount } from "./transactions";

const ACCOUNT_ID = "active-category-account";
const CATEGORY_X = "active-category-x";
const CATEGORY_Y = "active-category-y";
const CATEGORY_Z = "active-category-z";

const UNSPLIT_X = "active-unsplit-x";
const UNSPLIT_NULL = "active-unsplit-null";
const SPLIT_X_Y_PARENT_Z = "active-split-x-y-parent-z";
const SPLIT_X_NULL_PARENT_Z = "active-split-x-null-parent-z";
const SPLIT_X_X_PARENT_Z = "active-split-x-x-parent-z";
const SPLIT_PARENT_NULL_RULE = "active-split-parent-null-rule";
const SPLIT_Y_PARENT_X = "active-split-y-parent-x";

function sortedIds(rows: readonly { id: string }[]): string[] {
  return rows.map((row) => row.id).sort();
}

function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

async function installActiveCategoryFixture(db: Db): Promise<void> {
  await db.insert(accounts).values({
    id: ACCOUNT_ID,
    name: "Active Category Test Account",
    type: "CHECKING",
    currency: "USD",
  });
  await db.insert(categories).values([
    {
      id: CATEGORY_X,
      name: "Category X",
      keywords: JSON.stringify(["rule"]),
    },
    { id: CATEGORY_Y, name: "Category Y", keywords: "[]" },
    { id: CATEGORY_Z, name: "Category Z", keywords: "[]" },
  ]);
  await db.insert(transactions).values([
    {
      id: UNSPLIT_X,
      date: "2026-07-01",
      description: "UNSPLIT CATEGORY X",
      amountCents: -100,
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_X,
    },
    {
      id: UNSPLIT_NULL,
      date: "2026-07-02",
      description: "RULE UNSPLIT NULL",
      amountCents: -200,
      accountId: ACCOUNT_ID,
      categoryId: null,
    },
    {
      id: SPLIT_X_Y_PARENT_Z,
      date: "2026-07-03",
      description: "SPLIT X AND Y",
      amountCents: -300,
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_Z,
    },
    {
      id: SPLIT_X_NULL_PARENT_Z,
      date: "2026-07-04",
      description: "SPLIT X AND NULL",
      amountCents: -400,
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_Z,
    },
    {
      id: SPLIT_X_X_PARENT_Z,
      date: "2026-07-05",
      description: "SPLIT X TWICE",
      amountCents: -500,
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_Z,
    },
    {
      id: SPLIT_PARENT_NULL_RULE,
      date: "2026-07-06",
      description: "RULE SPLIT PARENT NULL",
      amountCents: -600,
      accountId: ACCOUNT_ID,
      categoryId: null,
    },
    {
      id: SPLIT_Y_PARENT_X,
      date: "2026-07-07",
      description: "SPLIT Y WITH IGNORED X PARENT",
      amountCents: -700,
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_X,
    },
  ]);
  await db.insert(transactionSplits).values([
    {
      id: "part-xy-x",
      transactionId: SPLIT_X_Y_PARENT_Z,
      categoryId: CATEGORY_X,
      amountCents: -100,
    },
    {
      id: "part-xy-y",
      transactionId: SPLIT_X_Y_PARENT_Z,
      categoryId: CATEGORY_Y,
      amountCents: -200,
    },
    {
      id: "part-xnull-x",
      transactionId: SPLIT_X_NULL_PARENT_Z,
      categoryId: CATEGORY_X,
      amountCents: -250,
    },
    {
      id: "part-xnull-null",
      transactionId: SPLIT_X_NULL_PARENT_Z,
      categoryId: null,
      amountCents: -150,
    },
    {
      id: "part-xx-first",
      transactionId: SPLIT_X_X_PARENT_Z,
      categoryId: CATEGORY_X,
      amountCents: -200,
    },
    {
      id: "part-xx-second",
      transactionId: SPLIT_X_X_PARENT_Z,
      categoryId: CATEGORY_X,
      amountCents: -300,
    },
    {
      id: "part-parent-null-y",
      transactionId: SPLIT_PARENT_NULL_RULE,
      categoryId: CATEGORY_Y,
      amountCents: -600,
    },
    {
      id: "part-parent-x-y",
      transactionId: SPLIT_Y_PARENT_X,
      categoryId: CATEGORY_Y,
      amountCents: -700,
    },
  ]);
}

describe("active category semantics (integration, temp DB)", () => {
  const ctx = setupTestDbPerTest("finance-active-category-");
  let db: Db;

  beforeEach(async () => {
    db = ctx.db;
    await installActiveCategoryFixture(db);
  });

  it("uses the canonical active category matrix for paged lists", async () => {
    const cases: ReadonlyArray<{
      categoryId: string | null;
      expectedIds: readonly string[];
    }> = [
      {
        categoryId: CATEGORY_X,
        expectedIds: [UNSPLIT_X, SPLIT_X_Y_PARENT_Z, SPLIT_X_NULL_PARENT_Z, SPLIT_X_X_PARENT_Z],
      },
      {
        categoryId: CATEGORY_Y,
        expectedIds: [SPLIT_X_Y_PARENT_Z, SPLIT_PARENT_NULL_RULE, SPLIT_Y_PARENT_X],
      },
      { categoryId: CATEGORY_Z, expectedIds: [] },
      { categoryId: null, expectedIds: [UNSPLIT_NULL, SPLIT_X_NULL_PARENT_Z] },
    ];

    for (const { categoryId, expectedIds } of cases) {
      const expected = [...expectedIds].sort();
      const page = await getTransactionsPage({ requestedPage: 1, categoryId }, db);

      expect(page.totalCount).toBe(expected.length);
      expect(sortedIds(page.items)).toEqual(expected);
      expect(new Set(page.items.map((row) => row.id)).size).toBe(page.items.length);
    }

    await expect(getUncategorizedTransactionCount(db)).resolves.toBe(2);

    const hostileCategory = `${CATEGORY_X}' OR 1=1 --`;
    await expect(
      getTransactionsPage({ requestedPage: 1, categoryId: hostileCategory }, db),
    ).resolves.toMatchObject({ totalCount: 0, items: [] });
  });

  it("keeps the correlated active-category predicate on the existing split index", async () => {
    const plan = await db.all<{ detail: string }>(sql`
      explain query plan
      select ${transactions.id}
      from ${transactions}
      where ${transactionMatchesActiveCategory(CATEGORY_X)}
    `);
    const details = plan.map((row) => row.detail);
    expect(
      details.filter((detail) => detail.includes("transaction_splits_transaction_idx")),
    ).toHaveLength(2);
  });

  it("reports distinct active usage, split parts, and ignored parent fallbacks", async () => {
    const stats = await getCategoriesWithStats(db);
    const categoryX = stats.find((category) => category.id === CATEGORY_X);
    const categoryY = stats.find((category) => category.id === CATEGORY_Y);
    const categoryZ = stats.find((category) => category.id === CATEGORY_Z);

    expect(categoryX).toMatchObject({
      transactionCount: 4,
      deletionImpact: {
        categoryId: CATEGORY_X,
        activeTransactionCount: 4,
        activeSplitPartCount: 4,
        ignoredParentTransactionCount: 1,
      },
    });
    expect(categoryY).toMatchObject({
      transactionCount: 3,
      deletionImpact: {
        categoryId: CATEGORY_Y,
        activeTransactionCount: 3,
        activeSplitPartCount: 3,
        ignoredParentTransactionCount: 0,
      },
    });
    expect(categoryZ).toMatchObject({
      transactionCount: 0,
      deletionImpact: {
        categoryId: CATEGORY_Z,
        activeTransactionCount: 0,
        activeSplitPartCount: 0,
        ignoredParentTransactionCount: 3,
      },
    });
  });

  it("deletes category X by nulling every FK while preserving parent and split rows and amounts", async () => {
    const beforeTransactions = await db.select().from(transactions);
    const beforeSplits = await db.select().from(transactionSplits);

    expect(await deleteCategory(CATEGORY_X, db)).toBe(CATEGORY_X);

    const afterTransactions = await db.select().from(transactions);
    const afterSplits = await db.select().from(transactionSplits);
    expect(
      afterTransactions.map(({ id, amountCents }) => ({ id, amountCents })).sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    ).toEqual(
      beforeTransactions.map(({ id, amountCents }) => ({ id, amountCents })).sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    );
    expect(
      afterSplits
        .map(({ id, transactionId, amountCents }) => ({ id, transactionId, amountCents }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      beforeSplits
        .map(({ id, transactionId, amountCents }) => ({ id, transactionId, amountCents }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );

    const parents = byId(afterTransactions);
    expect(parents.get(UNSPLIT_X)?.categoryId).toBeNull();
    expect(parents.get(SPLIT_Y_PARENT_X)?.categoryId).toBeNull();
    expect(parents.get(SPLIT_X_Y_PARENT_Z)?.categoryId).toBe(CATEGORY_Z);
    expect(parents.get(SPLIT_X_NULL_PARENT_Z)?.categoryId).toBe(CATEGORY_Z);
    expect(parents.get(SPLIT_X_X_PARENT_Z)?.categoryId).toBe(CATEGORY_Z);

    const parts = byId(afterSplits);
    expect(parts.get("part-xy-x")?.categoryId).toBeNull();
    expect(parts.get("part-xnull-x")?.categoryId).toBeNull();
    expect(parts.get("part-xx-first")?.categoryId).toBeNull();
    expect(parts.get("part-xx-second")?.categoryId).toBeNull();
    expect(parts.get("part-xy-y")?.categoryId).toBe(CATEGORY_Y);
    expect(parts.get("part-parent-null-y")?.categoryId).toBe(CATEGORY_Y);
    expect(parts.get("part-parent-x-y")?.categoryId).toBe(CATEGORY_Y);

    const uncategorized = await getTransactionsPage(
      { requestedPage: 1, categoryId: null },
      db,
    );
    expect(uncategorized.totalCount).toBe(5);
    await expect(getUncategorizedTransactionCount(db)).resolves.toBe(5);
    expect(sortedIds(uncategorized.items)).toEqual(
      [
        UNSPLIT_X,
        UNSPLIT_NULL,
        SPLIT_X_Y_PARENT_Z,
        SPLIT_X_NULL_PARENT_Z,
        SPLIT_X_X_PARENT_Z,
      ].sort(),
    );
  });

  it("applies rules only to unsplit null parents and leaves split-parent-null fallback untouched", async () => {
    await expect(applyRulesToUncategorized(db)).resolves.toEqual({
      status: "updated",
      scanned: 1,
      updated: 1,
    });

    const rows = byId(await db.select().from(transactions));
    expect(rows.get(UNSPLIT_NULL)?.categoryId).toBe(CATEGORY_X);
    expect(rows.get(SPLIT_PARENT_NULL_RULE)?.categoryId).toBeNull();
    expect(rows.get(SPLIT_X_Y_PARENT_Z)?.categoryId).toBe(CATEGORY_Z);
    expect(rows.get(SPLIT_X_NULL_PARENT_Z)?.categoryId).toBe(CATEGORY_Z);
    expect(rows.get(SPLIT_X_X_PARENT_Z)?.categoryId).toBe(CATEGORY_Z);

    const splitParts = await db.select().from(transactionSplits);
    expect(splitParts).toHaveLength(8);
    expect(splitParts.find((part) => part.id === "part-parent-null-y")?.categoryId).toBe(
      CATEGORY_Y,
    );
  });
});
