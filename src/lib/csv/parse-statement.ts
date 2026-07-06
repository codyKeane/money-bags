import { parse } from "csv-parse/sync";

export interface ParsedStatementRow {
  rowNumber: number; // 1-based line in the file (header is line 1)
  date: string; // normalized YYYY-MM-DD
  description: string;
  amountCents: number; // signed: negative = outflow
}

export interface StatementRowError {
  rowNumber: number;
  message: string;
}

export type DateFormat = "auto" | "MDY" | "DMY";

export interface ParseStatementOptions {
  dateFormat?: DateFormat;
  // Override header detection: canonical field -> actual header name in file.
  columnMap?: Partial<Record<"date" | "description" | "amount" | "debit" | "credit", string>>;
}

export interface ParseStatementResult {
  rows: ParsedStatementRow[];
  errors: StatementRowError[];
  // File-level, non-fatal advisories (e.g. ambiguous dates read as MM/DD). The
  // rows still imported; the user may want to re-import differently (F3).
  warnings: string[];
}

type CanonicalField = "date" | "description" | "amount" | "debit" | "credit";

// Ordered synonym lists: index = priority, lower wins. A file that carries
// both "Description" and "Memo" must store the description, never the memo —
// the flat-map approach let csv-parse's last-duplicate-wins silently replace
// (or blank) the real description.
const HEADER_PRIORITIES: Record<CanonicalField, readonly string[]> = {
  date: ["date", "transaction date", "trans date", "posted date", "post date"],
  description: ["description", "payee", "memo", "details", "narrative"],
  amount: ["amount", "transaction amount"],
  debit: ["debit", "withdrawal", "withdrawals", "money out"],
  credit: ["credit", "deposit", "deposits", "money in"],
};

const CANONICAL_FIELDS = Object.keys(HEADER_PRIORITIES) as CanonicalField[];

type ColumnConfig = CanonicalField | { name: string; disabled: true };

// One winner per canonical field: columnMap overrides (priority -1) beat and
// displace synonyms; among synonyms lower list index wins; ties go to the
// first-seen column. Losers and unmapped headers are disabled so a stray
// duplicate can never clobber the winner's value.
function resolveHeaderColumns(
  headers: readonly string[],
  overrides: ReadonlyMap<string, CanonicalField>,
): ColumnConfig[] {
  const claims = headers.map((header) => {
    const key = header.trim().toLowerCase();
    const override = overrides.get(key);
    if (override) return { field: override, priority: -1 };
    for (const field of CANONICAL_FIELDS) {
      const priority = HEADER_PRIORITIES[field].indexOf(key);
      if (priority !== -1) return { field, priority };
    }
    return null;
  });

  const winners = new Map<CanonicalField, number>(); // field -> header index
  claims.forEach((claim, i) => {
    if (!claim) return;
    const current = winners.get(claim.field);
    if (current === undefined || claim.priority < (claims[current]?.priority ?? Infinity)) {
      winners.set(claim.field, i);
    }
  });

  return headers.map((header, i) => {
    const claim = claims[i];
    if (claim && winners.get(claim.field) === i) return claim.field;
    return { name: header.trim().toLowerCase(), disabled: true };
  });
}

// "$1,234.56" / "(45.00)" / "45.00-" / "-45.00" -> signed cents, or null if
// unparseable. Integer math only — no float multiplication.
export function parseAmountToCents(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  const parenthesized = /^\((.*)\)$/.exec(s);
  if (parenthesized?.[1] !== undefined) {
    negative = true;
    s = parenthesized[1].trim();
  }
  if (s.endsWith("-")) {
    negative = !negative ? true : negative;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  // A trailing ",dd" can never be a US thousands group (those are always 3
  // digits), so it is unambiguously a decimal comma — but only when no "."
  // competes and it is the only comma. Mixed forms ("1.234,56", "1,234,56")
  // are rejected, never guessed: a loud row error beats a silent 100x
  // misparse.
  if (/,\d{2}$/.test(s)) {
    if (s.includes(".") || s.indexOf(",") !== s.lastIndexOf(",")) return null;
    s = s.replace(",", ".");
  }
  // strip currency symbols, spaces, thousands separators
  s = s.replace(/[$€£\s,]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!match || match[1] === undefined) return null;
  const dollars = parseInt(match[1], 10);
  const centsPart = match[2] ?? "";
  const cents = centsPart.length === 0 ? 0 : parseInt(centsPart.padEnd(2, "0"), 10);
  const total = dollars * 100 + cents;
  // Guard integer-cents math: past 2^53-1 the arithmetic above has already
  // lost precision, and SQLite would store the overflow as REAL.
  if (!Number.isSafeInteger(total)) return null;
  return negative ? -total : total;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toIso(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ISO always accepted; separated forms resolved per dateFormat. In 'auto',
// an unambiguous component decides; fully ambiguous dates fall back to MDY.
export function parseStatementDate(raw: string, dateFormat: DateFormat): string | null {
  const s = raw.trim();
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (iso) {
    return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (!parts) return null;
  const a = Number(parts[1]);
  const b = Number(parts[2]);
  const yearRaw = Number(parts[3]);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  let format: "MDY" | "DMY";
  if (dateFormat === "auto") {
    if (a > 12 && b <= 12) format = "DMY";
    else format = "MDY";
  } else {
    format = dateFormat;
  }
  return format === "MDY" ? toIso(year, a, b) : toIso(year, b, a);
}

// True when a separated date could be read either MM/DD or DD/MM and the two
// readings differ — i.e. both components are ≤ 12 and unequal. ISO dates, dates
// with a component > 12, and equal components (05/05) are never ambiguous. Used
// only to warn when 'auto' silently picks MDY (F3).
function isAmbiguousSeparatedDate(raw: string): boolean {
  const parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(raw.trim());
  if (!parts) return false;
  const a = Number(parts[1]);
  const b = Number(parts[2]);
  return a <= 12 && b <= 12 && a !== b;
}

interface RawRecord {
  record: Record<string, string>;
  info: { lines: number };
}

export function parseStatementCsv(
  text: string,
  options: ParseStatementOptions = {},
): ParseStatementResult {
  const dateFormat = options.dateFormat ?? "auto";
  const errors: StatementRowError[] = [];
  const rows: ParsedStatementRow[] = [];

  const overrides = new Map<string, CanonicalField>();
  for (const [canonical, header] of Object.entries(options.columnMap ?? {})) {
    if (header) {
      overrides.set(header.trim().toLowerCase(), canonical as CanonicalField);
    }
  }

  const warnings: string[] = [];
  let resolved: ColumnConfig[] = [];
  let rawHeaders: string[] = [];

  let records: RawRecord[];
  try {
    records = parse(text, {
      bom: true,
      columns: (headers: string[]) => {
        rawHeaders = headers.map((h) => h.trim());
        resolved = resolveHeaderColumns(headers, overrides);
        return resolved;
      },
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
      info: true,
    }) as unknown as RawRecord[];
  } catch (err) {
    return {
      rows: [],
      errors: [{ rowNumber: 0, message: `Unparseable CSV: ${(err as Error).message}` }],
      warnings,
    };
  }

  // One clear file-level error when a required column never resolves, instead of
  // the same "Missing date/description/amount" repeated on every data row (F3).
  const present = new Set(resolved.filter((c): c is CanonicalField => typeof c === "string"));
  const missing: string[] = [];
  if (!present.has("date")) missing.push("date");
  if (!present.has("description")) missing.push("description");
  if (!present.has("amount") && !present.has("debit") && !present.has("credit")) {
    missing.push("amount (or debit/credit)");
  }
  if (missing.length > 0) {
    const seen = rawHeaders.length > 0 ? rawHeaders.join(", ") : "(no header row)";
    return {
      rows: [],
      errors: [
        {
          rowNumber: 0,
          message: `Could not find a ${missing.join(", ")} column. Headers seen: ${seen}. Set an explicit column mapping and re-import.`,
        },
      ],
      warnings,
    };
  }

  let ambiguousDates = 0;

  for (const { record, info } of records) {
    const rowNumber = info.lines;
    const rawDate = record["date"];
    const rawDescription = record["description"];
    if (rawDate === undefined || rawDate === "") {
      errors.push({ rowNumber, message: "Missing date" });
      continue;
    }
    const date = parseStatementDate(rawDate, dateFormat);
    if (!date) {
      errors.push({ rowNumber, message: `Unparseable date "${rawDate}"` });
      continue;
    }
    if (dateFormat === "auto" && isAmbiguousSeparatedDate(rawDate)) ambiguousDates++;
    if (!rawDescription) {
      errors.push({ rowNumber, message: "Missing description" });
      continue;
    }

    const rawAmount = record["amount"];
    const rawDebit = record["debit"];
    const rawCredit = record["credit"];
    let amountCents: number | null = null;
    if (rawAmount !== undefined && rawAmount !== "") {
      amountCents = parseAmountToCents(rawAmount);
      if (amountCents === null) {
        errors.push({ rowNumber, message: `Unparseable amount "${rawAmount}"` });
        continue;
      }
    } else {
      const hasDebit = rawDebit !== undefined && rawDebit !== "";
      const hasCredit = rawCredit !== undefined && rawCredit !== "";
      if (hasDebit && hasCredit) {
        errors.push({ rowNumber, message: "Both debit and credit present" });
        continue;
      }
      if (!hasDebit && !hasCredit) {
        errors.push({ rowNumber, message: "No amount, debit, or credit value" });
        continue;
      }
      const rawValue = (hasDebit ? rawDebit : rawCredit) ?? "";
      const parsed = parseAmountToCents(rawValue);
      if (parsed === null) {
        errors.push({
          rowNumber,
          message: `Unparseable ${hasDebit ? "debit" : "credit"} "${rawValue}"`,
        });
        continue;
      }
      // Debit columns are outflows: positive values mean money out. Keep the
      // sign: a negative Debit is a refund (inflow), a negative Credit a
      // reversal (outflow).
      amountCents = hasDebit ? -parsed : parsed;
    }

    rows.push({ rowNumber, date, description: rawDescription, amountCents });
  }

  if (ambiguousDates > 0) {
    warnings.push(
      `${ambiguousDates} date${ambiguousDates === 1 ? " was" : "s were"} ambiguous ` +
        `(e.g. 03/04) and read as MM/DD. If this file uses DD/MM, re-import with the ` +
        `date format set to DD/MM/YYYY.`,
    );
  }

  return { rows, errors, warnings };
}
