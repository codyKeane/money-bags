import { describe, expect, it } from "vitest";
import { dollarsToCents } from "./money";

describe("dollarsToCents", () => {
  it("parses plain, signed, symbol'd, and comma'd dollars to signed cents", () => {
    expect(dollarsToCents("80")).toBe(8000);
    expect(dollarsToCents("-80.00")).toBe(-8000);
    expect(dollarsToCents("$1,234.56")).toBe(123456);
    expect(dollarsToCents(" 12.5 ")).toBe(1250);
    expect(dollarsToCents(".5")).toBe(50);
    expect(dollarsToCents("+7")).toBe(700);
  });

  it("returns null for anything that isn't a number", () => {
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("-")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(dollarsToCents("1.2.3")).toBeNull();
  });
});
