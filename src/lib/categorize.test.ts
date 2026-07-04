import { describe, expect, it } from "vitest";
import { categorize, parseKeywords, type CategoryMatcher } from "./categorize";

const matchers: CategoryMatcher[] = [
  { id: "cat-shopping", name: "Shopping", keywords: ["amazon"] },
  { id: "cat-entertainment", name: "Entertainment", keywords: ["prime video", "cinema"] },
  { id: "cat-groceries", name: "Groceries", keywords: ["market"] },
];

describe("categorize", () => {
  it("matches a keyword to its category", () => {
    expect(categorize("WHOLE HARVEST MARKET #12", matchers)).toBe("cat-groceries");
  });

  it("is case-insensitive", () => {
    expect(categorize("amazon mktplace", matchers)).toBe("cat-shopping");
    expect(categorize("AMAZON MKTPLACE", matchers)).toBe("cat-shopping");
  });

  it("returns null when nothing matches", () => {
    expect(categorize("UNKNOWN MERCHANT", matchers)).toBeNull();
  });

  it("prefers the longest matching keyword on multi-category matches", () => {
    // matches Shopping ("amazon", 6 chars) AND Entertainment ("prime video", 11)
    expect(categorize("AMAZON PRIME VIDEO", matchers)).toBe("cat-entertainment");
  });

  it("breaks equal-length ties by category name, deterministically", () => {
    const tied: CategoryMatcher[] = [
      { id: "b", name: "Beta", keywords: ["shop"] },
      { id: "a", name: "Alpha", keywords: ["shop"] },
    ];
    expect(categorize("SHOP", tied)).toBe("a");
    expect(categorize("SHOP", [...tied].reverse())).toBe("a");
  });
});

describe("parseKeywords", () => {
  it("parses a JSON string array", () => {
    expect(parseKeywords('["a","b"]')).toEqual(["a", "b"]);
  });

  it("returns [] for malformed JSON or non-arrays", () => {
    expect(parseKeywords("not json")).toEqual([]);
    expect(parseKeywords('{"a":1}')).toEqual([]);
    expect(parseKeywords('["a", 3]')).toEqual(["a"]);
  });
});
