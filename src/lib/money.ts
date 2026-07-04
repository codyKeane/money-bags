const formatters = new Map<string, Intl.NumberFormat>();

export function formatCents(cents: number, currency = "USD"): string {
  let fmt = formatters.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-US", { style: "currency", currency });
    formatters.set(currency, fmt);
  }
  return fmt.format(cents / 100);
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
