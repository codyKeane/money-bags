import { beforeEach, describe, expect, it } from "vitest";
import { accounts, categories, transactions } from "@/db/schema";
import { setupTestDbPerTest } from "@/test/test-db";
import { getBudgetVsActual, getMonthlySummary } from "./summary";
import {
  getRefundCandidates,
  getTransactionLinkState,
  getTransferCandidates,
  linkRefund,
  pairTransferTransactions,
  unlinkRefund,
  unpairTransferTransaction,
} from "./transaction-links";

describe("explicit transfer and refund relationships", () => {
  const ctx = setupTestDbPerTest("finance-links-");
  let checkingId: string;
  let savingsId: string;

  beforeEach(async () => {
    const inserted = await ctx.db
      .insert(accounts)
      .values([
        { id: "checking", name: "Checking", type: "CHECKING", currency: "USD" },
        { id: "savings", name: "Savings", type: "SAVINGS", currency: "USD" },
      ])
      .returning({ id: accounts.id });
    checkingId = inserted[0]?.id ?? "checking";
    savingsId = inserted[1]?.id ?? "savings";
    await ctx.db.insert(categories).values({
      id: "shopping",
      name: "Shopping",
      monthlyBudgetCents: 30000,
    });
    await ctx.db.insert(transactions).values([
      { id: "transfer-out", accountId: checkingId, date: "2026-06-01", description: "MOVE TO SAVINGS", amountCents: -15000, categoryId: "shopping" },
      { id: "transfer-in", accountId: savingsId, date: "2026-06-02", description: "SAVINGS DEPOSIT", amountCents: 15000, categoryId: "shopping" },
      { id: "pay", accountId: checkingId, date: "2026-06-03", description: "PAYROLL", amountCents: 200000 },
      { id: "purchase", accountId: checkingId, date: "2026-06-04", description: "LARGE PURCHASE", amountCents: -10000, categoryId: "shopping" },
      { id: "refund-a", accountId: checkingId, date: "2026-06-10", description: "PARTIAL REFUND", amountCents: 3000, categoryId: "shopping" },
      { id: "refund-b", accountId: checkingId, date: "2026-06-11", description: "FINAL REFUND", amountCents: 7000, categoryId: "shopping" },
    ]);
  });

  it("offers only equal opposite same-currency rows and pairing removes aggregate semantics", async () => {
    const candidates = await getTransferCandidates(10, ctx.db);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      source: { id: "transfer-out" },
      destination: { id: "transfer-in" },
      currency: "USD",
      dateDistanceDays: 1,
    });

    expect(await pairTransferTransactions("transfer-out", "transfer-in", ctx.db)).toMatchObject({
      status: "paired",
    });
    expect(await getTransferCandidates(10, ctx.db)).toHaveLength(0);
    expect(await getMonthlySummary("2026-06", ctx.db)).toEqual({
      incomeCents: 210000,
      spendingCents: 10000,
    });
    expect(await getBudgetVsActual("2026-06", ctx.db)).toMatchObject([
      { categoryName: "Shopping", spentCents: 10000 },
    ]);
    expect(await getTransactionLinkState("transfer-out", ctx.db)).toMatchObject({
      transferPairId: expect.any(String),
    });

    expect(await unpairTransferTransaction("transfer-in", ctx.db)).toEqual({ status: "unpaired" });
    expect(await getMonthlySummary("2026-06", ctx.db)).toEqual({
      incomeCents: 225000,
      spendingCents: 25000,
    });
  });

  it("links partial refunds without changing either ledger row and caps cumulative refunds", async () => {
    expect(await pairTransferTransactions("transfer-out", "transfer-in", ctx.db)).toMatchObject({
      status: "paired",
    });
    expect((await getRefundCandidates("refund-a", 10, ctx.db)).map((row) => row.id)).toEqual([
      "purchase",
    ]);
    expect(await linkRefund("refund-a", "purchase", ctx.db)).toMatchObject({ status: "linked" });
    expect(await getRefundCandidates("refund-b", 10, ctx.db)).toMatchObject([
      { id: "purchase", remainingRefundCents: 7000 },
    ]);
    expect(await linkRefund("refund-b", "purchase", ctx.db)).toMatchObject({ status: "linked" });
    expect(await linkRefund("refund-a", "purchase", ctx.db)).toMatchObject({ status: "already-linked" });
    expect(await getRefundCandidates("refund-b", 10, ctx.db)).toHaveLength(0);
    expect(await getMonthlySummary("2026-06", ctx.db)).toEqual({
      incomeCents: 200000,
      spendingCents: 0,
    });
    expect(await getBudgetVsActual("2026-06", ctx.db)).toMatchObject([
      { categoryName: "Shopping", spentCents: 0 },
    ]);

    expect(await unlinkRefund("refund-b", ctx.db)).toEqual({ status: "unlinked" });
    expect(await getMonthlySummary("2026-06", ctx.db)).toEqual({
      incomeCents: 207000,
      spendingCents: 7000,
    });
    expect(await getBudgetVsActual("2026-06", ctx.db)).toMatchObject([
      { categoryName: "Shopping", spentCents: 7000 },
    ]);
  });
});
