const formatters = new Map<string, Intl.NumberFormat>();

function formatExactCents(formatter: Intl.NumberFormat, cents: number): string {
  const hundred = BigInt(100);
  const zero = BigInt(0);
  const centsInteger = BigInt(cents === 0 ? 0 : cents);
  const whole = centsInteger / hundred;
  const remainder = centsInteger % hundred;
  const fraction = String(Number(remainder < zero ? -remainder : remainder)).padStart(2, "0");
  // BigInt keeps the whole-unit portion exact. For a negative amount below one
  // unit, use -1 only as a sign/currency template and replace its integer part.
  const templateWhole = centsInteger < zero && whole === zero ? -BigInt(1) : whole;
  return formatter
    .formatToParts(templateWhole)
    .map((part) => {
      if (part.type === "fraction") return fraction;
      if (part.type === "integer" && centsInteger < zero && whole === zero) return "0";
      return part.value;
    })
    .join("");
}

export function formatCents(cents: number, currency = "USD"): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("cents must be a safe integer");
  }
  let fmt = formatters.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      // Storage is uniformly hundredths, including currencies whose customary
      // minor-unit precision differs. Rendering must not discard stored cents.
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(currency, fmt);
  }
  return formatExactCents(fmt, cents);
}

// Parse editable decimal text to signed integer cents without passing through
// a binary floating-point dollar value. Symbols, grouping, exponent syntax,
// internal whitespace, and precision beyond cents are deliberately rejected.
export function decimalTextToCents(text: string): number | null {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d{1,2}))?|\.(\d{1,2}))$/.exec(text.trim());
  if (!match) return null;

  const sign = match[1];
  const wholeDigits = match[2] ?? "0";
  const fractionDigits = match[3] ?? match[4] ?? "";
  const unsignedDigits = `${wholeDigits}${fractionDigits.padEnd(2, "0")}`.replace(
    /^0+(?=\d)/,
    "",
  );
  const cents = Number(unsignedDigits);
  if (!Number.isSafeInteger(cents)) return null;
  if (cents === 0) return 0;
  return sign === "-" ? -cents : cents;
}

// Serialize safe integer cents exactly, including values near 2^53 - 1.
// Throwing here exposes programmer misuse instead of silently rounding output.
export function centsToDecimalText(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("cents must be a safe integer");
  }

  const sign = cents < 0 ? "-" : "";
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

// Compatibility name retained for existing editable-form callers. Its grammar
// is intentionally the same strict grammar as decimalTextToCents.
export function dollarsToCents(input: string): number | null {
  return decimalTextToCents(input);
}

// Compact form for chart axis ticks and direct labels: "$1.9K" above $1,000,
// whole dollars below ("$151.5" reads as a typo on a money label).
const compactFormatters = new Map<string, Intl.NumberFormat>();

export function formatCentsCompact(cents: number, currency = "USD"): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("cents must be a safe integer");
  }
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
  return fmt.format(cents === 0 ? 0 : cents / 100);
}
