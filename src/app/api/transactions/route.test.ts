import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getRecentTransactions = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/transactions", () => ({ getRecentTransactions }));

import { GET } from "./route";

describe("GET /api/transactions currency contract", () => {
  beforeEach(() => {
    getRecentTransactions.mockReset();
  });

  it("retains normalized currency plus raw and discriminated read state", async () => {
    getRecentTransactions.mockResolvedValue([
      {
        id: "transaction",
        rawCurrency: " jpy ",
        currency: " jpy ",
        normalizedCurrency: "JPY",
        currencyState: { kind: "valid", currency: "JPY" },
        amountCents: 123,
      },
      {
        id: "repair-transaction",
        rawCurrency: "not-a-code",
        currency: "not-a-code",
        normalizedCurrency: null,
        currencyState: { kind: "invalid" },
        amountCents: 456,
      },
    ]);

    const response = await GET(new NextRequest("http://127.0.0.1/api/transactions?limit=2"));
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getRecentTransactions).toHaveBeenCalledWith(2);
    expect(body.transactions[0]).toMatchObject({
      rawCurrency: " jpy ",
      currency: " jpy ",
      normalizedCurrency: "JPY",
      currencyState: { kind: "valid", currency: "JPY" },
    });
    expect(body.transactions[1]).toMatchObject({
      rawCurrency: "not-a-code",
      currency: "not-a-code",
      normalizedCurrency: null,
      currencyState: { kind: "invalid" },
    });
  });

  it("makes query-validation errors non-cacheable without service work", async () => {
    const response = await GET(
      new NextRequest("http://127.0.0.1/api/transactions?limit=not-an-integer"),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getRecentTransactions).not.toHaveBeenCalled();
  });
});
