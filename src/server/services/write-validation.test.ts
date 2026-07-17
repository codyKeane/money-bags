import { describe, expect, it } from "vitest";
import {
  normalizeFilename,
  normalizeTransactionNotes,
  normalizeTransactionTags,
  parseStoredTransactionTags,
  WRITE_LIMITS,
} from "./write-validation";

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

describe("transaction annotations", () => {
  it("normalizes optional multiline notes using Unicode code-point limits", () => {
    expect(normalizeTransactionNotes("  cafe\u0301\r\n\tmeeting  ")).toBe(
      "café\n\tmeeting",
    );
    expect(normalizeTransactionNotes("   ")).toBe("");
    expect(normalizeTransactionNotes("🙂".repeat(WRITE_LIMITS.transactionNotes))).toBe(
      "🙂".repeat(WRITE_LIMITS.transactionNotes),
    );
    expect(
      normalizeTransactionNotes("🙂".repeat(WRITE_LIMITS.transactionNotes + 1)),
    ).toBeNull();
  });

  it.each([
    "nul\0note",
    "control\x1fnote",
    "delete\x7fnote",
    "c1\x80note",
    "lone\ud800note",
    "bidi\u061cnote",
    "direction\u200fnote",
    "override\u202enote",
    "isolate\u2066note\u2069",
    "invisible\ufeffnote",
  ])(
    "rejects unsafe note text %j",
    (value) => {
      expect(normalizeTransactionNotes(value)).toBeNull();
    },
  );

  it("canonicalizes, deduplicates, and sorts tags deterministically", () => {
    expect(
      normalizeTransactionTags([
        "  Travel  ",
        "work   lunch",
        "TRAVEL",
        "cafe\u0301",
        "",
      ]),
    ).toEqual(["café", "travel", "work lunch"]);
  });

  it("rejects malformed, excessive, or unsafe tags", () => {
    expect(normalizeTransactionTags("travel")).toBeNull();
    expect(
      normalizeTransactionTags(
        Array.from({ length: WRITE_LIMITS.transactionTags + 1 }, (_, index) => `tag-${index}`),
      ),
    ).toBeNull();
    expect(
      normalizeTransactionTags(["x".repeat(WRITE_LIMITS.transactionTag + 1)]),
    ).toBeNull();
    expect(normalizeTransactionTags(["comma,inside"])).toBeNull();
    expect(normalizeTransactionTags(["line\nbreak"])).toBeNull();
    expect(normalizeTransactionTags(["lone\ud800tag"])).toBeNull();
    expect(normalizeTransactionTags(["override\u202etag"])).toBeNull();
    expect(normalizeTransactionTags(["isolate\u2066tag\u2069"])).toBeNull();
    expect(normalizeTransactionTags(["invisible\ufefftag"])).toBeNull();
    expect(normalizeTransactionTags([123])).toBeNull();
  });

  it("enforces the serialized tag bound and tolerates malformed stored JSON", () => {
    const escaped = Array.from(
      { length: WRITE_LIMITS.transactionTags },
      (_, index) => `${index}`.padStart(2, "0") + "\\".repeat(38),
    );
    expect(normalizeTransactionTags(escaped)).toBeNull();
    expect(parseStoredTransactionTags('["Travel","travel"," Work  Lunch "]')).toEqual([
      "travel",
      "work lunch",
    ]);
    expect(parseStoredTransactionTags("not-json")).toEqual([]);
    expect(parseStoredTransactionTags('{"tag":"travel"}')).toEqual([]);
    expect(parseStoredTransactionTags(" ".repeat(WRITE_LIMITS.transactionTagsJson + 1))).toEqual([]);
  });
});
