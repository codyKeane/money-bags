import { describe, expect, it } from "vitest";
import {
  centsToDecimalText,
  decimalTextToCents,
  dollarsToCents,
  formatCents,
  formatCentsCompact,
} from "./money";

describe("currency formatting", () => {
  it("uses the requested currency while retaining the stored hundredths", () => {
    expect(formatCents(1234, "USD")).toContain("$12.34");
    expect(formatCents(1234, "EUR")).toContain("€12.34");
    expect(formatCents(1234, "JPY")).toContain("¥12.34");
  });

  it("never emits a negative-zero amount", () => {
    expect(formatCents(-0, "USD")).toBe("$0.00");
    expect(formatCentsCompact(-0, "USD")).not.toContain("-");
  });

  it("formats boundary safe cents without floating-point loss", () => {
    expect(formatCents(Number.MAX_SAFE_INTEGER, "USD")).toBe("$90,071,992,547,409.91");
    expect(formatCents(Number.MIN_SAFE_INTEGER, "USD")).toBe("-$90,071,992,547,409.91");
    expect(formatCents(-5, "EUR")).toBe("-€0.05");
  });

  it("rejects unsafe or non-integer cents before formatting", () => {
    for (const cents of [Number.MAX_SAFE_INTEGER + 1, 1.5, Number.NaN]) {
      expect(() => formatCents(cents, "USD")).toThrow(RangeError);
      expect(() => formatCentsCompact(cents, "USD")).toThrow(RangeError);
    }
  });
});

describe("decimalTextToCents", () => {
  it("parses the locked editable decimal grammar", () => {
    expect(decimalTextToCents("0")).toBe(0);
    expect(decimalTextToCents("-0")).toBe(0);
    expect(Object.is(decimalTextToCents("-0"), -0)).toBe(false);
    expect(decimalTextToCents("+.5")).toBe(50);
    expect(decimalTextToCents("-.05")).toBe(-5);
    expect(decimalTextToCents("1.2")).toBe(120);
    expect(decimalTextToCents("1.23")).toBe(123);
    expect(decimalTextToCents("\u00a0\t12.5\u2003")).toBe(1250);
    expect(decimalTextToCents("+7")).toBe(700);
  });

  it("rejects non-editable syntax and excess precision instead of normalizing or rounding", () => {
    for (const input of [
      "",
      "-",
      "+",
      ".",
      "1.",
      "1.230",
      "1.005",
      "1e2",
      "$1.23",
      "1,234.56",
      "1 2.34",
      "1.2.3",
      "abc",
    ]) {
      expect(decimalTextToCents(input), input).toBeNull();
    }
  });

  it("accepts only values whose exact cents are safe integers", () => {
    expect(decimalTextToCents("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(decimalTextToCents("-90071992547409.91")).toBe(Number.MIN_SAFE_INTEGER);
    expect(decimalTextToCents("90071992547409.92")).toBeNull();
    expect(decimalTextToCents("-90071992547409.92")).toBeNull();
    expect(decimalTextToCents("999999999999999999999999999999.99")).toBeNull();
  });
});

describe("centsToDecimalText", () => {
  it("serializes safe integer cents with exactly two decimal digits", () => {
    expect(centsToDecimalText(0)).toBe("0.00");
    expect(centsToDecimalText(-0)).toBe("0.00");
    expect(centsToDecimalText(5)).toBe("0.05");
    expect(centsToDecimalText(-120)).toBe("-1.20");
    expect(centsToDecimalText(9007199254740990)).toBe("90071992547409.90");
    expect(centsToDecimalText(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    expect(centsToDecimalText(Number.MIN_SAFE_INTEGER)).toBe("-90071992547409.91");
  });

  it("round-trips representative and boundary safe cent values", () => {
    for (const cents of [
      Number.MIN_SAFE_INTEGER,
      -101,
      -100,
      -1,
      0,
      1,
      99,
      100,
      101,
      9007199254740990,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(decimalTextToCents(centsToDecimalText(cents)), String(cents)).toBe(cents);
    }
  });

  it("throws rather than rounding unsafe or non-integer values", () => {
    for (const cents of [Number.MAX_SAFE_INTEGER + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => centsToDecimalText(cents), String(cents)).toThrow(RangeError);
    }
  });
});

describe("dollarsToCents", () => {
  it("is a compatibility alias for the strict editable grammar", () => {
    expect(dollarsToCents("80")).toBe(8000);
    expect(dollarsToCents("-80.00")).toBe(-8000);
    expect(dollarsToCents(".5")).toBe(50);
    expect(dollarsToCents("$1,234.56")).toBeNull();
    expect(dollarsToCents("1.005")).toBeNull();
  });
});
