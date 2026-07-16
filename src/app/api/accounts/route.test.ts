import { describe, expect, it, vi } from "vitest";

const getAccountsWithBalances = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/accounts", () => ({ getAccountsWithBalances }));

import { GET } from "./route";

describe("GET /api/accounts currency contract", () => {
  it("retains normalized currency plus raw and discriminated read state", async () => {
    getAccountsWithBalances.mockResolvedValue([
      {
        id: "euro-account",
        name: "Euro",
        rawCurrency: " eur ",
        currency: " eur ",
        normalizedCurrency: "EUR",
        currencyState: { kind: "valid", currency: "EUR" },
        balanceCents: 123,
        balanceState: { kind: "ready" },
      },
      {
        id: "repair-account",
        name: "Repair",
        rawCurrency: "not-a-code",
        currency: "not-a-code",
        normalizedCurrency: null,
        currencyState: { kind: "invalid" },
        balanceCents: 456,
        balanceState: { kind: "ready" },
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.accounts[0]).toMatchObject({
      rawCurrency: " eur ",
      currency: " eur ",
      normalizedCurrency: "EUR",
      currencyState: { kind: "valid", currency: "EUR" },
    });
    expect(body.accounts[1]).toMatchObject({
      rawCurrency: "not-a-code",
      currency: "not-a-code",
      normalizedCurrency: null,
      currencyState: { kind: "invalid" },
    });
  });
});
