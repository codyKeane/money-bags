// Month keys are "YYYY-MM" strings — the substr(date, 1, 7) bucketing unit.

export function isValidMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = (y ?? 0) * 12 + ((m ?? 1) - 1) + delta;
  const year = Math.floor(total / 12);
  const mon = (total % 12) + 1;
  return `${year}-${String(mon).padStart(2, "0")}`;
}

// First calendar day of a month as an ISO date ("2026-06" -> "2026-06-01").
export function monthStart(month: string): string {
  return `${month}-01`;
}

// Half-open ISO date range [start, endExclusive) covering exactly `month`.
// Used for index-friendly `date >= start AND date < endExclusive` predicates
// (a range hits transactions_date_idx; substr(date,1,7) = m forces a scan).
export function monthRange(month: string): { start: string; endExclusive: string } {
  return { start: monthStart(month), endExclusive: monthStart(addMonths(month, 1)) };
}

export function currentUtcMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// "2026-07" -> "July 2026" (UTC-safe: no Date parsing of the month string)
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1]} ${y}`;
}

// "2026-02" -> "Feb" (axis ticks)
export function formatMonthShort(month: string): string {
  const [, m] = month.split("-").map(Number);
  return (MONTH_NAMES[(m ?? 1) - 1] ?? "").slice(0, 3);
}

// "2026-07-07" -> "Jul 7, 2026" for display (UX16). String-only, no Date
// parsing, so it stays TZ-safe like the rest of ledger date math. Falls back to
// the raw value if it isn't a well-formed ISO date.
export function formatIsoDate(value: string): string {
  if (!isValidIsoDate(value)) return value;
  const [y, m, d] = value.split("-").map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1]?.slice(0, 3)} ${d}, ${y}`;
}

// Calendar-checked YYYY-MM-DD (matches the ledger's date column format).
export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}
