import { beforeAll, describe, expect, it } from "vitest";
import { type Db } from "@/db/client";
import { setupTestDb } from "@/test/test-db";
import { accounts, transactions } from "@/db/schema";
import {
  createAccount,
  deleteAccount,
  getAccountsWithBalances,
  getNetWorth,
  getNetWorthOverview,
  updateAccount,
} from "./accounts";

describe("accounts service (integration, temp DB)", () => {
  const ctx = setupTestDb("finance-acct-");
  let db: Db;
  let checkingId: string;
  let cardId: string;

  beforeAll(async () => {
    db = ctx.db;
    checkingId = (
      await createAccount({ name: "Checking", type: "CHECKING", openingBalanceCents: 10000 }, db)
    ).id;
    cardId = (await createAccount({ name: "Card", type: "CREDIT_CARD" }, db)).id;
    await db.insert(transactions).values([
      { date: "2026-06-01", description: "PAY", amountCents: 5000, accountId: checkingId },
      { date: "2026-06-02", description: "SHOP", amountCents: -2000, accountId: cardId },
    ]);
  });

  it("reports balances and transaction counts", async () => {
    const rows = await getAccountsWithBalances(db);
    const checking = rows.find((r) => r.id === checkingId);
    const card = rows.find((r) => r.id === cardId);
    expect(checking).toMatchObject({ balanceCents: 15000, transactionCount: 1 });
    expect(card).toMatchObject({ balanceCents: -2000, transactionCount: 1 });
    expect(await getNetWorth(db)).toBe(13000);
  });

  it("updating the opening balance moves the computed balance", async () => {
    const updated = await updateAccount(
      checkingId,
      { name: "Checking", type: "CHECKING", institution: "Bank", openingBalanceCents: 20000 },
      db,
    );
    expect(updated).toBe(checkingId);
    const rows = await getAccountsWithBalances(db);
    expect(rows.find((r) => r.id === checkingId)).toMatchObject({
      balanceCents: 25000,
      institution: "Bank",
    });
  });

  it("deleting an account cascades to its transactions only", async () => {
    expect(await deleteAccount(cardId, db)).toBe(cardId);
    const remaining = await db.select().from(transactions);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.accountId).toBe(checkingId);
    expect(await getNetWorth(db)).toBe(25000);
  });
});

describe("getNetWorthOverview (integration, temp DB)", () => {
  const ctx = setupTestDb("finance-networth-");

  beforeAll(async () => {
    await ctx.db.insert(accounts).values([
      { name: "USD A", type: "CHECKING", currency: "USD", openingBalanceCents: 10000 },
      { name: "USD B", type: "SAVINGS", currency: "USD", openingBalanceCents: 5000 },
    ]);
  });

  it("reports one currency and the summed net worth when all match", async () => {
    const overview = await getNetWorthOverview(ctx.db);
    expect(overview.netWorthCents).toBe(15000);
    expect(overview.currencies).toEqual(["USD"]);
  });

  it("surfaces every distinct currency (sorted) once accounts are mixed (F8)", async () => {
    await ctx.db.insert(accounts).values([
      { name: "Euro", type: "CHECKING", currency: "EUR", openingBalanceCents: 20000 },
    ]);
    const overview = await getNetWorthOverview(ctx.db);
    expect(overview.currencies).toEqual(["EUR", "USD"]);
    expect(overview.netWorthCents).toBe(35000);
  });
});
