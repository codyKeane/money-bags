import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const prepareTransactionExport = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/transaction-export", () => ({ prepareTransactionExport }));

import { GET, runtime } from "./route";

function request(query = ""): NextRequest {
  return new NextRequest(`http://127.0.0.1/api/export${query ? `?${query}` : ""}`);
}

function csvStream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

describe("GET /api/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the Node runtime and preserves omitted format as legacy", async () => {
    prepareTransactionExport.mockResolvedValue({
      status: "ready",
      stream: csvStream("Date,Description,Amount,Account,Category\r\n"),
      isClosed: () => true,
    });

    const response = await GET(request("month=2026-07&category=uncategorized"));

    expect(runtime).toBe("nodejs");
    expect(prepareTransactionExport).toHaveBeenCalledWith(
      { categoryId: null, month: "2026-07" },
      "legacy",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="transactions-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("Date,Description,Amount,Account,Category\r\n");
  });

  it("passes detailed format and sanitized filters to the service", async () => {
    prepareTransactionExport.mockResolvedValue({
      status: "ready",
      stream: csvStream("detailed"),
      isClosed: () => true,
    });

    await GET(request("format=detailed&q=%20Coffee%20&from=not-a-date&to=2026-07-31"));

    expect(prepareTransactionExport).toHaveBeenCalledWith(
      { q: "Coffee", to: "2026-07-31" },
      "detailed",
    );
  });

  it("passes annotated format and an exact normalized tag filter", async () => {
    prepareTransactionExport.mockResolvedValue({
      status: "ready",
      stream: csvStream("annotated"),
      isClosed: () => true,
    });

    await GET(request("format=annotated&tag=%20Work%20"));

    expect(prepareTransactionExport).toHaveBeenCalledWith({ tag: "work" }, "annotated");
  });

  it("rejects an unknown format without calling the export service", async () => {
    const response = await GET(request("format=allocation"));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "invalid-format",
      message: "format must be legacy, detailed, or annotated.",
    });
    expect(prepareTransactionExport).not.toHaveBeenCalled();
  });

  it("maps mixed legacy currency to a repairable typed conflict", async () => {
    prepareTransactionExport.mockResolvedValue({ status: "mixed-currency" });

    const response = await GET(request("format=legacy"));

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: "mixed-currency" });
  });

  it("returns only safe account identity for invalid currency", async () => {
    prepareTransactionExport.mockResolvedValue({
      status: "invalid-currency",
      accounts: [{ id: "repair-id", name: "Repair me" }],
    });

    const response = await GET(request("format=detailed"));
    const text = await response.text();

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(text)).toMatchObject({
      error: "invalid-currency",
      accounts: [{ id: "repair-id", name: "Repair me" }],
    });
    expect(text).not.toContain("not-a-code");
  });

  it("maps unsafe historical data to a typed conflict", async () => {
    prepareTransactionExport.mockResolvedValue({ status: "unsafe-data" });

    const response = await GET(request("format=detailed"));

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: "unsafe-data" });
  });

  it("returns a non-cacheable generic error for an unexpected export failure", async () => {
    prepareTransactionExport.mockRejectedValue(new Error("sensitive synthetic failure"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await GET(request("format=detailed"));
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(text).not.toContain("sensitive synthetic failure");
      expect(consoleError).toHaveBeenCalledWith(
        "transaction export route failed unexpectedly",
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
