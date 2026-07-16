import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccountsWithBalances: vi.fn(),
  buildNetWorthOverview: vi.fn(),
}));

vi.mock("@/server/services/accounts", () => mocks);

import { GET } from "./route";

describe("GET /api/summary/net-worth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a discriminator and no false scalar for mixed currencies", async () => {
    const rows = [
      {
        id: "usd-account",
        name: "Dollars",
        type: "CHECKING",
        rawCurrency: "USD",
        currency: "USD",
        normalizedCurrency: "USD",
        currencyState: { kind: "valid", currency: "USD" },
        balanceCents: 100,
        balanceState: { kind: "ready" },
      },
      {
        id: "eur-account",
        name: "Euros",
        type: "SAVINGS",
        rawCurrency: " eur ",
        currency: " eur ",
        normalizedCurrency: "EUR",
        currencyState: { kind: "valid", currency: "EUR" },
        balanceCents: 200,
        balanceState: { kind: "ready" },
      },
    ];
    mocks.getAccountsWithBalances.mockResolvedValue(rows);
    mocks.buildNetWorthOverview.mockReturnValue({
      netWorthCents: null,
      currencyState: { kind: "mixed", currencies: ["EUR", "USD"] },
      aggregateState: { kind: "unavailable" },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      netWorthCents: null,
      currencyState: { kind: "mixed", currencies: ["EUR", "USD"] },
      aggregateState: { kind: "unavailable" },
    });
    expect(body.accounts.map((account: { currency: string }) => account.currency))
      .toEqual(["USD", " eur "]);
    expect(body.accounts.map((account: { normalizedCurrency: string | null }) => account.normalizedCurrency))
      .toEqual(["USD", "EUR"]);
  });

  it("keeps an invalid account explicit without relabeling it USD", async () => {
    const rows = [
      {
        id: "repair-account",
        name: "Repair me",
        type: "CASH",
        rawCurrency: "not-a-code",
        currency: "not-a-code",
        normalizedCurrency: null,
        currencyState: { kind: "invalid" },
        balanceCents: 42,
        balanceState: { kind: "ready" },
      },
    ];
    mocks.getAccountsWithBalances.mockResolvedValue(rows);
    mocks.buildNetWorthOverview.mockReturnValue({
      netWorthCents: null,
      currencyState: {
        kind: "invalid",
        accounts: [{ id: "repair-account", name: "Repair me" }],
      },
      aggregateState: { kind: "unavailable" },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.netWorthCents).toBeNull();
    expect(body.accounts[0]).toMatchObject({
      rawCurrency: "not-a-code",
      currency: "not-a-code",
      normalizedCurrency: null,
      currencyState: { kind: "invalid" },
    });
  });
});
