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
}

const HEADER_SYNONYMS: Record<string, "date" | "description" | "amount" | "debit" | "credit"> = {
  "date": "date",
  "transaction date": "date",
  "posted date": "date",
  "post date": "date",
  "trans date": "date",
  "description": "description",
  "memo": "description",
  "payee": "description",
  "details": "description",
  "narrative": "description",
  "amount": "amount",
  "transaction amount": "amount",
  "debit": "debit",
  "withdrawal": "debit",
  "withdrawals": "debit",
  "money out": "debit",
  "credit": "credit",
  "deposit": "credit",
  "deposits": "credit",
  "money in": "credit",
};

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
  // strip currency symbols, spaces, thousands separators
  s = s.replace(/[$€£\s,]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!match || match[1] === undefined) return null;
  const dollars = parseInt(match[1], 10);
  const centsPart = match[2] ?? "";
  const cents = centsPart.length === 0 ? 0 : parseInt(centsPart.padEnd(2, "0"), 10);
  const total = dollars * 100 + cents;
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

  const overrides = new Map<string, "date" | "description" | "amount" | "debit" | "credit">();
  for (const [canonical, header] of Object.entries(options.columnMap ?? {})) {
    if (header) {
      overrides.set(
        header.trim().toLowerCase(),
        canonical as "date" | "description" | "amount" | "debit" | "credit",
      );
    }
  }

  let records: RawRecord[];
  try {
    records = parse(text, {
      bom: true,
      columns: (headers: string[]) =>
        headers.map((h) => {
          const key = h.trim().toLowerCase();
          return overrides.get(key) ?? HEADER_SYNONYMS[key] ?? { name: key, disabled: true };
        }),
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
    };
  }

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
      // debit columns are outflows: positive values mean money out
      amountCents = hasDebit ? -Math.abs(parsed) : Math.abs(parsed);
    }

    rows.push({ rowNumber, date, description: rawDescription, amountCents });
  }

  return { rows, errors };
}
