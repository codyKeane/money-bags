import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveCurrencyState,
  inspectCurrencyCode,
  normalizeCurrencyCode,
} from "./currency";

describe("normalizeCurrencyCode", () => {
  it.each([
    ["USD", "USD"],
    [" eur ", "EUR"],
    ["jpy", "JPY"],
    ["\tusd\n", "USD"],
  ])("normalizes a renderable three-letter code %j", (input, expected) => {
    expect(normalizeCurrencyCode(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [123],
    [""],
    ["US"],
    ["USDD"],
    ["U$D"],
    ["U D"],
    ["12A"],
    ["€UR"],
  ])("rejects a non-code value %j", (input) => {
    expect(normalizeCurrencyCode(input)).toBeNull();
  });

  it("accepts a renderable reserved identifier without claiming registry membership", () => {
    expect(normalizeCurrencyCode("XTS")).toBe("XTS");
  });

  it("rejects a syntactically valid code when the runtime formatter rejects it", () => {
    const RealNumberFormat = Intl.NumberFormat;
    const formatter = vi.spyOn(Intl, "NumberFormat").mockImplementation(function (
      this: Intl.NumberFormat,
      locales?: Intl.LocalesArgument,
      options?: Intl.NumberFormatOptions,
    ) {
      if (options?.currency === "ZZZ") {
        throw new RangeError("synthetic unsupported currency");
      }
      return new RealNumberFormat(locales, options);
    } as typeof Intl.NumberFormat);

    try {
      expect(normalizeCurrencyCode("zzz")).toBeNull();
    } finally {
      formatter.mockRestore();
    }
  });

  it("rejects a formatter that constructs but fails when used", () => {
    const formatter = vi.spyOn(Intl, "NumberFormat").mockImplementation(function () {
      return {
        format: () => {
          throw new RangeError("synthetic lazy failure");
        },
      } as unknown as Intl.NumberFormat;
    } as typeof Intl.NumberFormat);

    try {
      expect(normalizeCurrencyCode("ZZZ")).toBeNull();
    } finally {
      formatter.mockRestore();
    }
  });
});

describe("inspectCurrencyCode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the normalized code for a renderable value", () => {
    expect(inspectCurrencyCode(" eur ")).toEqual({ kind: "valid", currency: "EUR" });
  });

  it("returns a value-free invalid result", () => {
    const rawCurrency = "not-a-secret-safe-code";
    const result = inspectCurrencyCode(rawCurrency);

    expect(result).toEqual({ kind: "invalid" });
    expect(JSON.stringify(result)).not.toContain(rawCurrency);
  });
});

describe("deriveCurrencyState", () => {
  it("returns empty when there are no accounts", () => {
    expect(deriveCurrencyState([])).toEqual({ kind: "empty" });
  });

  it("returns one normalized currency without mutating persisted input", () => {
    const rows = [
      { id: "account-2", name: "Savings", rawCurrency: " eur " },
      { id: "account-1", name: "Checking", rawCurrency: "EUR" },
    ];
    const before = structuredClone(rows);

    expect(deriveCurrencyState(rows)).toEqual({ kind: "single", currency: "EUR" });
    expect(rows).toEqual(before);
  });

  it("deduplicates normalized codes and sorts a mixed state", () => {
    expect(
      deriveCurrencyState([
        { id: "3", name: "Yen", rawCurrency: "jpy" },
        { id: "2", name: "Dollars", rawCurrency: " USD " },
        { id: "4", name: "More dollars", rawCurrency: "usd" },
        { id: "1", name: "Euros", rawCurrency: "EUR" },
      ]),
    ).toEqual({ kind: "mixed", currencies: ["EUR", "JPY", "USD"] });
  });

  it("returns only safe account identity for invalid currencies in deterministic order", () => {
    const unsafeRows = [
      { id: "account-z", name: "Zebra", rawCurrency: "raw-private-value-z" },
      { id: "account-b", name: "Alpha", rawCurrency: "raw-private-value-b" },
      { id: "account-a", name: "Alpha", rawCurrency: "raw-private-value-a" },
      { id: "valid", name: "Valid", rawCurrency: "usd" },
    ];
    const expected = {
      kind: "invalid",
      accounts: [
        { id: "account-a", name: "Alpha" },
        { id: "account-b", name: "Alpha" },
        { id: "account-z", name: "Zebra" },
      ],
    } as const;

    const first = deriveCurrencyState(unsafeRows);
    const second = deriveCurrencyState([...unsafeRows].reverse());

    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("raw-private-value");
    expect(serialized).not.toContain("rawCurrency");
  });
});
