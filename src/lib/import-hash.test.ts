import { describe, expect, it } from "vitest";
import { computeImportHashes, normalizeDescription } from "./import-hash";

// COMPATIBILITY LOCK: never update these literals merely to make a test pass.
// A changed digest requires a separately approved compatibility migration that
// preserves v1 lookup for every existing imported transaction.
const GOLDEN_VECTORS = [
  {
    accountId: "acct-1",
    date: "2026-06-03",
    amountCents: -450,
    description: "COFFEE SHOP",
    normalizedDescription: "coffee shop",
    occurrenceIndex: 0,
    digest: "794efbe010c9cc75108641472b6f79684a5a25c06fd4ea57143e5b01dc671580",
  },
  {
    accountId: "acct-1",
    date: "2026-06-03",
    amountCents: -450,
    description: "COFFEE SHOP",
    normalizedDescription: "coffee shop",
    occurrenceIndex: 1,
    digest: "1462da3aa0fcdaa4c22b355a0d4003ff9c7859a002fd6bf0d132ed620b240829",
  },
] as const;

const UTF8_VECTOR = {
  accountId: "acct-utf8",
  date: "2026-06-04",
  amountCents: -1234,
  description: "  CAFÉ\t東京  ",
  normalizedDescription: "café 東京",
  occurrenceIndex: 0,
  digest: "4964f1f53bbc525779872fe45958aee9e57b9b1a13094c1e728fc5d12c30a294",
} as const;

const row = {
  date: GOLDEN_VECTORS[0].date,
  amountCents: GOLDEN_VECTORS[0].amountCents,
  description: GOLDEN_VECTORS[0].description,
};

describe("computeImportHashes", () => {
  it("matches the frozen v1 golden vectors for occurrence indexes 0 and 1", () => {
    const rows = GOLDEN_VECTORS.map((vector) => ({
      date: vector.date,
      amountCents: vector.amountCents,
      description: vector.description,
    }));
    expect(GOLDEN_VECTORS.map((vector) => normalizeDescription(vector.description))).toEqual(
      GOLDEN_VECTORS.map((vector) => vector.normalizedDescription),
    );
    expect(GOLDEN_VECTORS.map((vector) => vector.occurrenceIndex)).toEqual([0, 1]);
    expect(computeImportHashes(GOLDEN_VECTORS[0].accountId, rows)).toEqual(
      GOLDEN_VECTORS.map((vector) => vector.digest),
    );
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

  it("hashes normalized UTF-8 descriptions byte-for-byte", () => {
    expect(UTF8_VECTOR.occurrenceIndex).toBe(0);
    expect(normalizeDescription(UTF8_VECTOR.description)).toBe(
      UTF8_VECTOR.normalizedDescription,
    );
    expect(
      computeImportHashes(UTF8_VECTOR.accountId, [
        {
          date: UTF8_VECTOR.date,
          amountCents: UTF8_VECTOR.amountCents,
          description: UTF8_VECTOR.description,
        },
      ]),
    ).toEqual([UTF8_VECTOR.digest]);
  });

  it("assigns occurrence indexes by identical key even when other rows move", () => {
    const other = {
      date: "2026-06-04",
      amountCents: -1234,
      description: "CAFÉ 東京",
    };
    const original = computeImportHashes("acct-1", [row, other, { ...row }]);
    const reordered = computeImportHashes("acct-1", [other, row, { ...row }]);
    expect(original).toEqual([
      GOLDEN_VECTORS[0].digest,
      original[1],
      GOLDEN_VECTORS[1].digest,
    ]);
    expect(reordered).not.toEqual(original);
    expect(reordered).toEqual([
      original[1],
      GOLDEN_VECTORS[0].digest,
      GOLDEN_VECTORS[1].digest,
    ]);
  });

  it("differs across accounts", () => {
    const [a] = computeImportHashes("acct-1", [row]);
    const [b] = computeImportHashes("acct-2", [row]);
    expect(a).not.toBe(b);
  });
});

describe("normalizeDescription", () => {
  it("trims, collapses whitespace, lowercases", () => {
    expect(normalizeDescription("  ACME\t  CORP\n ")).toBe("acme corp");
  });
});
