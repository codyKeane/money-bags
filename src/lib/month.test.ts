import { describe, expect, it } from "vitest";
import {
  addMonths,
  currentUtcMonth,
  formatMonth,
  formatMonthShort,
  isValidIsoDate,
  isValidMonth,
  monthRange,
  monthStart,
} from "./month";

describe("isValidMonth", () => {
  it("accepts YYYY-MM in range", () => {
    expect(isValidMonth("2026-01")).toBe(true);
    expect(isValidMonth("2026-12")).toBe(true);
  });
  it("rejects out-of-range or malformed months", () => {
    expect(isValidMonth("2026-00")).toBe(false);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("2026-1")).toBe(false);
    expect(isValidMonth("not-a-month")).toBe(false);
  });
});

describe("addMonths", () => {
  it("is a no-op for delta 0", () => {
    expect(addMonths("2026-07", 0)).toBe("2026-07");
  });
  it("rolls forward across the year boundary", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-11", 3)).toBe("2027-02");
  });
  it("rolls backward across the year boundary", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-02", -3)).toBe("2025-11");
  });
  it("spans multiple years", () => {
    expect(addMonths("2020-06", 25)).toBe("2022-07");
    expect(addMonths("2020-06", -25)).toBe("2018-05");
  });
});

describe("monthStart / monthRange", () => {
  it("monthStart is the first ISO day", () => {
    expect(monthStart("2026-06")).toBe("2026-06-01");
  });
  it("monthRange is half-open [start, nextMonthStart)", () => {
    expect(monthRange("2026-06")).toEqual({
      start: "2026-06-01",
      endExclusive: "2026-07-01",
    });
  });
  it("monthRange crosses the year boundary at December", () => {
    expect(monthRange("2026-12")).toEqual({
      start: "2026-12-01",
      endExclusive: "2027-01-01",
    });
  });
});

describe("currentUtcMonth", () => {
  it("returns a well-formed YYYY-MM", () => {
    expect(currentUtcMonth()).toMatch(/^\d{4}-\d{2}$/);
    expect(isValidMonth(currentUtcMonth())).toBe(true);
  });
});

describe("formatMonth / formatMonthShort", () => {
  it("formats without timezone drift", () => {
    expect(formatMonth("2026-07")).toBe("July 2026");
    expect(formatMonth("2026-01")).toBe("January 2026");
    expect(formatMonthShort("2026-02")).toBe("Feb");
  });
});

describe("isValidIsoDate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidIsoDate("2026-06-30")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true); // leap year
  });
  it("rejects impossible dates", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isValidIsoDate("2026-06-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-00-10")).toBe(false);
    expect(isValidIsoDate("2026-6-1")).toBe(false); // not zero-padded
    expect(isValidIsoDate("06/30/2026")).toBe(false);
  });
});
