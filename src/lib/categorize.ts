export interface CategoryMatcher {
  id: string;
  name: string;
  keywords: string[];
}

// Case-insensitive substring match against the description. Precedence:
// longest matching keyword wins; ties broken by category name — deterministic
// regardless of category iteration order.
export function categorize(
  description: string,
  matchers: readonly CategoryMatcher[],
): string | null {
  const haystack = description.toLowerCase();
  let best: { id: string; keywordLength: number; name: string } | null = null;
  for (const matcher of matchers) {
    for (const raw of matcher.keywords) {
      const keyword = raw.trim().toLowerCase();
      if (!keyword || !haystack.includes(keyword)) continue;
      if (
        !best ||
        keyword.length > best.keywordLength ||
        (keyword.length === best.keywordLength && matcher.name < best.name)
      ) {
        best = { id: matcher.id, keywordLength: keyword.length, name: matcher.name };
      }
    }
  }
  return best?.id ?? null;
}

// categories.keywords is a JSON string[] stored as TEXT; tolerate bad data.
export function parseKeywords(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}
