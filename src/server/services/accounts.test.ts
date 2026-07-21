import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/db/client";
import { setupTestDbPerTest } from "@/test/test-db";
import { accounts, transactions } from "@/db/schema";
import {
  createAccount,
  deleteAccount,
  getAccountById,
  getAccountsWithBalances,
  getNetWorth,
  getNetWorthOverview,
  type CreateAccountInput,
  type UpdateAccountInput,
  updateAccount,
} from "./accounts";

async function mustCreateAccount(input: CreateAccountInput, db: Db) {
  const result = await createAccount(input, db);
  if (result.status !== "created") throw new Error(`account fixture failed: ${result.status}`);
  return result.account;
}

describe("accounts service (integration, temp DB)", () => {
  const ctx = setupTestDbPerTest("finance-acct-");
  let db: Db;
  let checkingId: string;
  let cardId: string;

  beforeEach(async () => {
    db = ctx.db;
    checkingId = (await mustCreateAccount(
      { name: "Checking", type: "CHECKING", currency: "USD", openingBalanceCents: 10000 },
      db,
    )).id;
    cardId = (await mustCreateAccount(
      { name: "Card", type: "CREDIT_CARD", currency: "USD" },
      db,
    )).id;
    await db.insert(transactions).values([
      { date: "2026-06-01", description: "PAY", amountCents: 5000, accountId: checkingId },
      { date: "2026-06-02", description: "SHOP", amountCents: -2000, accountId: cardId },
    ]);
  });

  it("reports balances and transaction counts", async () => {
    const rows = await getAccountsWithBalances(db);
    const checking = rows.find((r) => r.id === checkingId);
    const card = rows.find((r) => r.id === cardId);
    expect(checking).toMatchObject({
      rawCurrency: "USD",
      currencyState: { kind: "valid", currency: "USD" },
      balanceCents: 15000,
      balanceState: { kind: "ready" },
      transactionCount: 1,
    });
    expect(card).toMatchObject({
      rawCurrency: "USD",
      currencyState: { kind: "valid", currency: "USD" },
      balanceCents: -2000,
      balanceState: { kind: "ready" },
      transactionCount: 1,
    });
    expect(await getNetWorth(db)).toBe(13000);
  });

  it("normalizes persisted renderable currencies in memory and leaves storage untouched", async () => {
    const [inserted] = await db
      .insert(accounts)
      .values({ name: "Padded euro", type: "CASH", currency: " eur " })
      .returning({ id: accounts.id });
    if (!inserted) throw new Error("account fixture failed");

    const row = (await getAccountsWithBalances(db)).find((account) => account.id === inserted.id);
    expect(row).toMatchObject({
      rawCurrency: " eur ",
      currency: " eur ",
      normalizedCurrency: "EUR",
      currencyState: { kind: "valid", currency: "EUR" },
      balanceCents: 0,
      balanceState: { kind: "ready" },
    });
    expect((await getAccountById(inserted.id, db))?.currencyState).toEqual({
      kind: "valid",
      currency: "EUR",
    });

    const persisted = (await db
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts))
      .find((account) => account.id === inserted.id);
    expect(persisted?.currency).toBe(" eur ");
  });

  it("keeps an invalid persisted currency readable without exposing a false formatted balance", async () => {
    const [inserted] = await db
      .insert(accounts)
      .values({ name: "Needs repair", type: "CASH", currency: "US dollars", openingBalanceCents: 42 })
      .returning({ id: accounts.id });
    if (!inserted) throw new Error("account fixture failed");

    const row = (await getAccountsWithBalances(db)).find((account) => account.id === inserted.id);
    expect(row).toMatchObject({
      rawCurrency: "US dollars",
      currency: "US dollars",
      normalizedCurrency: null,
      currencyState: { kind: "invalid" },
      balanceCents: 42,
      balanceState: { kind: "ready" },
    });
    expect((await getAccountById(inserted.id, db))).toMatchObject({
      id: inserted.id,
      rawCurrency: "US dollars",
      currencyState: { kind: "invalid" },
    });
    expect(JSON.stringify(row?.currencyState)).not.toContain("US dollars");
  });

  it("updating the opening balance moves the computed balance", async () => {
    const updated = await updateAccount(
      checkingId,
      {
        name: "Checking",
        type: "CHECKING",
        institution: "Bank",
        currency: "USD",
        openingBalanceCents: 20000,
      },
      db,
    );
    expect(updated).toEqual({ status: "updated", id: checkingId });
    const rows = await getAccountsWithBalances(db);
    expect(rows.find((r) => r.id === checkingId)).toMatchObject({
      balanceCents: 25000,
      institution: "Bank",
    });
  });

  it("accepts a valid opening balance date and rejects malformed dates", async () => {
    const created = await createAccount(
      {
        name: "Dated opening",
        type: "CHECKING",
        currency: "USD",
        openingBalanceCents: 5000,
        openingBalanceDate: "2026-01-15",
      },
      db,
    );
    expect(created.status).toBe("created");
    if (created.status !== "created") return;
    expect(created.account.openingBalanceDate).toBe("2026-01-15");
    await expect(
      updateAccount(
        created.account.id,
        {
          name: "Dated opening",
          type: "CHECKING",
          institution: null,
          currency: "USD",
          openingBalanceCents: 5000,
          openingBalanceDate: "2026-02-30",
        },
        db,
      ),
    ).resolves.toMatchObject({ status: "invalid-input", field: "openingBalanceDate" });
  });

  it("deleting an account cascades to its transactions only", async () => {
    await updateAccount(
      checkingId,
      {
        name: "Checking",
        type: "CHECKING",
        institution: "Bank",
        currency: "USD",
        openingBalanceCents: 20000,
      },
      db,
    );
    expect(await deleteAccount(cardId, db)).toBe(cardId);
    const remaining = await db.select().from(transactions);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.accountId).toBe(checkingId);
    expect(await getNetWorth(db)).toBe(25000);
  });

  it("rejects unsafe cents and invalid names or currencies without writing", async () => {
    const before = await db.select().from(accounts);

    await expect(
      createAccount(
        {
          name: "Unsafe",
          type: "CHECKING",
          currency: "USD",
          openingBalanceCents: Number.MAX_SAFE_INTEGER + 1,
        },
        db,
      ),
    ).resolves.toMatchObject({ status: "invalid-input", field: "openingBalanceCents" });
    await expect(
      createAccount({ name: "   ", type: "CHECKING", currency: "USD" }, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "name" });
    await expect(
      createAccount({ name: "Bad Currency", type: "CHECKING", currency: "US dollars" }, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "currency" });
    await expect(
      createAccount({ name: "Bad type", type: "BROKERAGE" as never, currency: "USD" }, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "type" });
    await expect(
      createAccount(
        {
          name: "Long institution",
          type: "CHECKING",
          institution: "x".repeat(121),
          currency: "USD",
        },
        db,
      ),
    ).resolves.toMatchObject({ status: "invalid-input", field: "institution" });

    await expect(
      createAccount({ name: "Missing currency", type: "CHECKING" } as CreateAccountInput, db),
    ).resolves.toMatchObject({ status: "invalid-input", field: "currency" });

    expect(await db.select().from(accounts)).toHaveLength(before.length);
  });

  it("returns typed duplicate and not-found outcomes without parsing database errors", async () => {
    await expect(
      createAccount({ name: " Checking ", type: "SAVINGS", currency: "USD" }, db),
    ).resolves.toEqual({ status: "duplicate-name" });
    await expect(
      updateAccount(
        cardId,
        {
          name: "Checking",
          type: "CREDIT_CARD",
          institution: null,
          currency: "USD",
          openingBalanceCents: 0,
        },
        db,
      ),
    ).resolves.toEqual({ status: "duplicate-name" });
    await expect(
      updateAccount(
        "missing-account",
        {
          name: "Missing",
          type: "CASH",
          institution: null,
          currency: "USD",
          openingBalanceCents: 0,
        },
        db,
      ),
    ).resolves.toEqual({ status: "not-found" });
  });

  it("rejects an invalid update without changing the stored row", async () => {
    const before = await getAccountById(checkingId, db);
    const unsafeCents = await updateAccount(
      checkingId,
      {
        name: "Changed",
        type: "CHECKING",
        institution: null,
        currency: "USD",
        openingBalanceCents: Number.NaN,
      },
      db,
    );
    expect(unsafeCents).toMatchObject({ status: "invalid-input", field: "openingBalanceCents" });
    const invalidCurrency = await updateAccount(
      checkingId,
      {
        name: "Changed",
        type: "CHECKING",
        institution: null,
        currency: "US dollars",
        openingBalanceCents: 0,
      },
      db,
    );
    expect(invalidCurrency).toMatchObject({ status: "invalid-input", field: "currency" });
    expect(await getAccountById(checkingId, db)).toEqual(before);
  });

  it.each([
    [" eur ", "EUR"],
    ["jpy", "JPY"],
    ["XTS", "XTS"],
  ])("normalizes a required renderable currency on create and update: %j", async (input, expected) => {
    const created = await createAccount(
      { name: `Currency ${expected}`, type: "CASH", currency: input, openingBalanceCents: 10 },
      db,
    );
    expect(created.status).toBe("created");
    if (created.status !== "created") return;
    expect(created.account.currency).toBe(expected);

    expect(
      await updateAccount(
        created.account.id,
        {
          name: `${expected} cash`,
          type: "CASH",
          institution: null,
          currency: ` ${expected.toLowerCase()} `,
          openingBalanceCents: 20,
        },
        db,
      ),
    ).toEqual({ status: "updated", id: created.account.id });
    expect((await getAccountById(created.account.id, db))?.rawCurrency).toBe(expected);
  });

  it("requires currency on update without changing the stored row", async () => {
    const before = await getAccountById(checkingId, db);
    const withoutCurrency = {
      name: "Changed",
      type: "CHECKING",
      institution: null,
      openingBalanceCents: 0,
    } as UpdateAccountInput;

    await expect(updateAccount(checkingId, withoutCurrency, db)).resolves.toMatchObject({
      status: "invalid-input",
      field: "currency",
    });
    expect(await getAccountById(checkingId, db)).toEqual(before);
  });
});

describe("account name conflicts across connections", () => {
  it("returns duplicate-name when another connection already won the insert", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "finance-acct-conflict-"));
    const file = path.join(dir, "test.db");
    const first = createTestDb(file);
    const second = createTestDb(file);
    try {
      expect(
        (await createAccount({ name: "Shared", type: "CHECKING", currency: "USD" }, second.db))
          .status,
      ).toBe("created");
      await expect(
        createAccount({ name: "Shared", type: "SAVINGS", currency: "USD" }, first.db),
      ).resolves.toEqual({ status: "duplicate-name" });
    } finally {
      second.sqlite.close();
      first.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("getNetWorthOverview (integration, temp DB)", () => {
  const ctx = setupTestDbPerTest("finance-networth-");

  beforeEach(async () => {
    await ctx.db.insert(accounts).values([
      { name: "USD A", type: "CHECKING", currency: "USD", openingBalanceCents: 10000 },
      { name: "USD B", type: "SAVINGS", currency: "USD", openingBalanceCents: 5000 },
    ]);
  });

  it("reports one currency and the summed net worth when all match", async () => {
    const overview = await getNetWorthOverview(ctx.db);
    expect(overview).toEqual({
      currencyState: { kind: "single", currency: "USD" },
      aggregateState: { kind: "ready" },
      netWorthCents: 15000,
      currencyGroups: expect.arrayContaining([
        expect.objectContaining({
          currency: "USD",
          accountNames: ["USD A", "USD B"],
          netWorthCents: 15000,
          aggregateState: { kind: "ready" },
        }),
      ]),
    });
    expect(await getNetWorth(ctx.db)).toBe(15000);
  });

  it("normalizes matching non-USD persisted codes without mutating them", async () => {
    await ctx.db.delete(accounts);
    await ctx.db.insert(accounts).values([
      { name: "Euro A", type: "CHECKING", currency: " eur ", openingBalanceCents: 20000 },
      { name: "Euro B", type: "SAVINGS", currency: "EUR", openingBalanceCents: -5000 },
    ]);

    const overview = await getNetWorthOverview(ctx.db);
    expect(overview).toEqual({
      currencyState: { kind: "single", currency: "EUR" },
      aggregateState: { kind: "ready" },
      netWorthCents: 15000,
      currencyGroups: expect.arrayContaining([
        expect.objectContaining({
          currency: "EUR",
          accountNames: ["Euro A", "Euro B"],
          netWorthCents: 15000,
          aggregateState: { kind: "ready" },
        }),
      ]),
    });
    const persisted = await ctx.db
      .select({ name: accounts.name, currency: accounts.currency })
      .from(accounts);
    expect(persisted).toEqual([
      { name: "Euro A", currency: " eur " },
      { name: "Euro B", currency: "EUR" },
    ]);
  });

  it("returns no combined scalar for mixed currencies, including zero and negative balances", async () => {
    await ctx.db.insert(accounts).values([
      { name: "Euro negative", type: "CHECKING", currency: "EUR", openingBalanceCents: -20000 },
      { name: "Yen zero", type: "CASH", currency: "JPY", openingBalanceCents: 0 },
    ]);

    expect(await getNetWorthOverview(ctx.db)).toEqual({
      currencyState: { kind: "mixed", currencies: ["EUR", "JPY", "USD"] },
      aggregateState: { kind: "unavailable" },
      netWorthCents: null,
      currencyGroups: expect.arrayContaining([
        expect.objectContaining({ currency: "EUR", netWorthCents: -20000 }),
        expect.objectContaining({ currency: "JPY", netWorthCents: 0 }),
        expect.objectContaining({ currency: "USD", netWorthCents: 15000 }),
      ]),
    });
    expect(await getNetWorth(ctx.db)).toBeNull();
  });

  it("returns no combined scalar and only safe account identity for invalid currency", async () => {
    await ctx.db.insert(accounts).values({
      id: "needs-repair-id",
      name: "Needs repair",
      type: "CHECKING",
      currency: "not-a-code",
      openingBalanceCents: 9000,
    });

    const overview = await getNetWorthOverview(ctx.db);
    expect(overview).toEqual({
      currencyState: {
        kind: "invalid",
        accounts: [{ id: "needs-repair-id", name: "Needs repair" }],
      },
      aggregateState: { kind: "unavailable" },
      netWorthCents: null,
      currencyGroups: [],
    });
    expect(JSON.stringify(overview)).not.toContain("not-a-code");
  });

  it("returns an explicit unsafe state when safe account balances have an unsafe sum", async () => {
    await ctx.db.delete(accounts);
    await ctx.db.insert(accounts).values([
      {
        name: "Maximum",
        type: "CHECKING",
        currency: "USD",
        openingBalanceCents: Number.MAX_SAFE_INTEGER,
      },
      { name: "One more", type: "CASH", currency: "USD", openingBalanceCents: 1 },
    ]);

    expect(await getAccountsWithBalances(ctx.db)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Maximum",
          balanceCents: Number.MAX_SAFE_INTEGER,
          balanceState: { kind: "ready" },
        }),
        expect.objectContaining({
          name: "One more",
          balanceCents: 1,
          balanceState: { kind: "ready" },
        }),
      ]),
    );
    expect(await getNetWorthOverview(ctx.db)).toEqual({
      currencyState: { kind: "single", currency: "USD" },
      aggregateState: { kind: "unsafe" },
      netWorthCents: null,
      currencyGroups: [
        expect.objectContaining({
          currency: "USD",
          netWorthCents: null,
          aggregateState: { kind: "unsafe" },
        }),
      ],
    });
    expect(await getNetWorth(ctx.db)).toBeNull();
  });

  it("returns an explicit unsafe per-account balance instead of a rounded scalar", async () => {
    await ctx.db.delete(accounts);
    const [account] = await ctx.db
      .insert(accounts)
      .values({
        name: "Unsafe balance",
        type: "CHECKING",
        currency: "USD",
        openingBalanceCents: Number.MAX_SAFE_INTEGER,
      })
      .returning({ id: accounts.id });
    if (!account) throw new Error("account fixture failed");
    await ctx.db.insert(transactions).values({
      date: "2026-06-01",
      description: "OVERFLOW",
      amountCents: 1,
      accountId: account.id,
    });

    const [row] = await getAccountsWithBalances(ctx.db);
    expect(row).toMatchObject({
      balanceCents: null,
      balanceState: { kind: "unsafe" },
    });
    expect(await getNetWorthOverview(ctx.db)).toEqual({
      currencyState: { kind: "single", currency: "USD" },
      aggregateState: { kind: "unsafe" },
      netWorthCents: null,
      currencyGroups: [
        expect.objectContaining({
          currency: "USD",
          netWorthCents: null,
          aggregateState: { kind: "unsafe" },
        }),
      ],
    });
  });

  it("returns an unavailable empty state without inventing a zero-currency total", async () => {
    await ctx.db.delete(accounts);

    expect(await getNetWorthOverview(ctx.db)).toEqual({
      currencyState: { kind: "empty" },
      aggregateState: { kind: "unavailable" },
      netWorthCents: null,
      currencyGroups: [],
    });
    expect(await getNetWorth(ctx.db)).toBeNull();
  });
});
