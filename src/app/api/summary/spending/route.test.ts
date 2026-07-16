import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getNetWorthOverview: vi.fn(),
  getLatestTransactionMonth: vi.fn(),
  getMonthlySpendingOverview: vi.fn(),
}));

vi.mock("@/server/services/accounts", () => ({
  getNetWorthOverview: mocks.getNetWorthOverview,
}));
vi.mock("@/server/services/transactions", () => ({
  getLatestTransactionMonth: mocks.getLatestTransactionMonth,
}));
vi.mock("@/server/services/summary", () => {
  return { getMonthlySpendingOverview: mocks.getMonthlySpendingOverview };
});

import { GET } from "./route";

function request(month = "2026-06"): NextRequest {
  return new NextRequest(`http://127.0.0.1/api/summary/spending?month=${month}`);
}

describe("GET /api/summary/spending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLatestTransactionMonth.mockResolvedValue("2026-06");
  });

  it("sets every combined scalar to null and skips aggregate queries in mixed mode", async () => {
    mocks.getNetWorthOverview.mockResolvedValue({
      netWorthCents: null,
      currencyState: { kind: "mixed", currencies: ["EUR", "USD"] },
      aggregateState: { kind: "unavailable" },
    });
    mocks.getMonthlySpendingOverview.mockResolvedValue({
      currencyState: { kind: "mixed", currencies: ["EUR", "USD"] },
      aggregateState: { kind: "unavailable" },
      summary: { incomeCents: null, spendingCents: null },
      byCategory: [],
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      month: "2026-06",
      currencyState: { kind: "mixed", currencies: ["EUR", "USD"] },
      aggregateState: { kind: "unavailable" },
      summary: { incomeCents: null, spendingCents: null },
      byCategory: [],
    });
    expect(mocks.getMonthlySpendingOverview).toHaveBeenCalledWith(
      "2026-06",
      expect.objectContaining({ aggregateState: { kind: "unavailable" } }),
    );
  });

  it("returns numeric aggregates only for a ready single currency", async () => {
    mocks.getNetWorthOverview.mockResolvedValue({
      netWorthCents: 100,
      currencyState: { kind: "single", currency: "EUR" },
      aggregateState: { kind: "ready" },
    });
    mocks.getMonthlySpendingOverview.mockResolvedValue({
      currencyState: { kind: "single", currency: "EUR" },
      aggregateState: { kind: "ready" },
      summary: { incomeCents: 500, spendingCents: 200 },
      byCategory: [
        { categoryId: null, categoryName: null, color: null, spentCents: 200 },
      ],
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      currencyState: { kind: "single", currency: "EUR" },
      aggregateState: { kind: "ready" },
      summary: { incomeCents: 500, spendingCents: 200 },
    });
    expect(body.byCategory).toHaveLength(1);
  });

  it("makes invalid-month and empty-state responses non-cacheable", async () => {
    const invalid = await GET(request("not-a-month"));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("no-store");

    mocks.getNetWorthOverview.mockResolvedValue({
      netWorthCents: 0,
      currencyState: { kind: "empty" },
      aggregateState: { kind: "empty" },
    });
    mocks.getLatestTransactionMonth.mockResolvedValue(null);
    const empty = await GET(
      new NextRequest("http://127.0.0.1/api/summary/spending"),
    );

    expect(empty.status).toBe(200);
    expect(empty.headers.get("cache-control")).toBe("no-store");
    await expect(empty.json()).resolves.toMatchObject({ month: null, summary: null });
  });
});
