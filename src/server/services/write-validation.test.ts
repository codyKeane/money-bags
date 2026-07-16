import { describe, expect, it } from "vitest";
import { normalizeFilename } from "./write-validation";

describe("normalizeFilename", () => {
  it.each([
    ["/synthetic/path/statement.csv", "statement.csv"],
    ["C:\\synthetic\\path\\statement.csv", "statement.csv"],
    ["mixed/path\\statement.csv", "statement.csv"],
    ["path/cafe\u0301.csv", "café.csv"],
    ["  statement.csv  ", "  statement.csv  "],
  ])("normalizes display filename %j", (input, expected) => {
    expect(normalizeFilename(input)).toBe(expected);
  });

  it("counts Unicode code points rather than UTF-16 code units", () => {
    expect(normalizeFilename("🙂".repeat(255))).toBe("🙂".repeat(255));
    expect(normalizeFilename("🙂".repeat(256))).toBeNull();
  });

  it.each([
    undefined,
    "",
    "/path/",
    "\\path\\",
    ".",
    "..",
    "nul\0name.csv",
    "control\x1fname.csv",
    "delete\x7fname.csv",
    "c1\x80name.csv",
    "unpaired\ud800.csv",
  ])("rejects unsafe display filename %j", (input) => {
    expect(normalizeFilename(input)).toBeNull();
  });
});
