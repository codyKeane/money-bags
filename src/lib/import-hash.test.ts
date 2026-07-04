import { describe, expect, it } from "vitest";
import { computeImportHashes, normalizeDescription } from "./import-hash";

const row = { date: "2026-06-03", amountCents: -450, description: "COFFEE SHOP" };

describe("computeImportHashes", () => {
  it("gives identical rows in one batch distinct occurrence-indexed hashes", () => {
    const hashes = computeImportHashes("acct-1", [row, { ...row }]);
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it("re-hashing the same batch yields identical hashes (idempotent re-import)", () => {
    const batch = [row, { ...row }, { ...row, amountCents: -500 }];
    expect(computeImportHashes("acct-1", batch)).toEqual(computeImportHashes("acct-1", batch));
  });

  it("normalizes description whitespace and case into the hash", () => {
    const [a] = computeImportHashes("acct-1", [row]);
    const [b] = computeImportHashes("acct-1", [
      { ...row, description: "  coffee   SHOP " },
    ]);
    expect(a).toBe(b);
  });

  it("differs across accounts", () => {
    const [a] = computeImportHashes("acct-1", [row]);
    const [b] = computeImportHashes("acct-2", [row]);
    expect(a).not.toBe(b);
  });
});

describe("normalizeDescription", () => {
  it("trims, collapses whitespace, lowercases", () => {
    expect(normalizeDescription("  ACME   CORP  ")).toBe("acme corp");
  });
});
