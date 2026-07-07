const formatters = new Map<string, Intl.NumberFormat>();

export function formatCents(cents: number, currency = "USD"): string {
  let fmt = formatters.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-US", { style: "currency", currency });
    formatters.set(currency, fmt);
  }
  return fmt.format(cents / 100);
}

// Parse a user-typed dollar string ("-80.00", "$1,234.5", "12") to signed cents,
// or null if it isn't a number. Client-safe (no deps) so the split editor can
// show a live remainder; the split action re-validates the resulting sum
// server-side, so this stays a UI convenience, not the source of truth. The CSV
// importer uses the stricter parseAmountToCents (bank formats, decimal commas).
export function dollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

// Compact form for chart axis ticks and direct labels: "$1.9K" above $1,000,
// whole dollars below ("$151.5" reads as a typo on a money label).
const compactFormatters = new Map<string, Intl.NumberFormat>();

export function formatCentsCompact(cents: number, currency = "USD"): string {
  const key = `${currency}:${Math.abs(cents) >= 100_000 ? "compact" : "whole"}`;
  let fmt = compactFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      ...(Math.abs(cents) >= 100_000
        ? { notation: "compact" as const, maximumFractionDigits: 1 }
        : { maximumFractionDigits: 0 }),
    });
    compactFormatters.set(key, fmt);
  }
  return fmt.format(cents / 100);
}
