import { parse } from "csv-parse/sync";
import { decimalTextToCents } from "../money";

export interface ParsedStatementRow {
  rowNumber: number;
  date: string;
  description: string;
  amountCents: number;
}

export interface StatementRowError {
  rowNumber: number;
  message: string;
}

export type DateFormat = "auto" | "MDY" | "DMY";
export type CanonicalField = "date" | "description" | "amount" | "debit" | "credit";

export interface ColumnMapIssue {
  code:
    | "invalid-shape"
    | "empty-map"
    | "unknown-field"
    | "invalid-header"
    | "duplicate-claim"
    | "missing-header"
    | "duplicate-header";
  field: CanonicalField | "columnMap";
  message: string;
}

export type ColumnMap = Partial<Record<CanonicalField, string>>;

export interface ParseStatementOptions {
  dateFormat?: DateFormat;
  // Intentionally unknown at this trust boundary: API JSON and direct service
  // callers receive the same strict validator instead of silent fallback.
  columnMap?: unknown;
}

interface ParseStatementBase {
  rows: ParsedStatementRow[];
  errors: StatementRowError[];
  warnings: string[];
}

export type ParseStatementResult =
  | ({ status: "ready" } & ParseStatementBase)
  | ({ status: "date-format-required"; ambiguousRowNumbers: number[] } & ParseStatementBase)
  | ({ status: "invalid-column-map"; issues: ColumnMapIssue[] } & ParseStatementBase)
  | ({ status: "invalid-file" } & ParseStatementBase);

const HEADER_PRIORITIES: Record<CanonicalField, readonly string[]> = {
  date: ["date", "transaction date", "trans date", "posted date", "post date"],
  description: ["description", "payee", "memo", "details", "narrative"],
  amount: ["amount", "transaction amount"],
  debit: ["debit", "withdrawal", "withdrawals", "money out"],
  credit: ["credit", "deposit", "deposits", "money in"],
};

const CANONICAL_FIELDS = Object.keys(HEADER_PRIORITIES) as CanonicalField[];
const CANONICAL_FIELD_SET = new Set<string>(CANONICAL_FIELDS);
const HEADER_CONTROLS = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_HEADER_CODE_POINTS = 120;

type ColumnConfig = CanonicalField | { name: string; disabled: true };

function invalidColumnMap(issues: ColumnMapIssue[]): ParseStatementResult {
  return {
    status: "invalid-column-map",
    rows: [],
    errors: [],
    warnings: [],
    issues,
  };
}

function invalidFile(errors: StatementRowError[]): ParseStatementResult {
  return { status: "invalid-file", rows: [], errors, warnings: [] };
}

export function validateColumnMap(
  value: unknown,
): { ok: true; value: ColumnMap | undefined } | { ok: false; issues: ColumnMapIssue[] } {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      issues: [
        {
          code: "invalid-shape",
          field: "columnMap",
          message: "Column map must be a plain JSON object.",
        },
      ],
    };
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return {
      ok: false,
      issues: [
        {
          code: "invalid-shape",
          field: "columnMap",
          message: "Column map must be a plain JSON object.",
        },
      ],
    };
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  const issues: ColumnMapIssue[] = [];
  if (keys.length === 0 && Object.getOwnPropertySymbols(value).length === 0) {
    issues.push({
      code: "empty-map",
      field: "columnMap",
      message: "Column map must contain at least one mapping.",
    });
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    issues.push({
      code: "unknown-field",
      field: "columnMap",
      message: "Column map contains an unknown canonical field.",
    });
  }

  const normalized: ColumnMap = {};
  for (const key of keys) {
    if (!CANONICAL_FIELD_SET.has(key)) {
      issues.push({
        code: "unknown-field",
        field: "columnMap",
        message: "Column map contains an unknown canonical field.",
      });
      continue;
    }
    const field = key as CanonicalField;
    const descriptor = descriptors[key];
    const raw = descriptor && "value" in descriptor ? descriptor.value : undefined;
    if (typeof raw !== "string") {
      issues.push({
        code: "invalid-header",
        field,
        message: "Mapped header must be text.",
      });
      continue;
    }
    const header = raw.trim();
    if (
      header.length === 0 ||
      [...header].length > MAX_HEADER_CODE_POINTS ||
      HEADER_CONTROLS.test(header)
    ) {
      issues.push({
        code: "invalid-header",
        field,
        message: "Mapped header must be 1 to 120 characters without control characters.",
      });
      continue;
    }
    normalized[field] = header;
  }

  const claims = new Map<string, CanonicalField>();
  for (const field of CANONICAL_FIELDS) {
    const header = normalized[field];
    if (header === undefined) continue;
    const claim = header.toLocaleLowerCase("en-US");
    const existing = claims.get(claim);
    if (existing) {
      issues.push({
        code: "duplicate-claim",
        field,
        message: "Two canonical fields cannot claim the same source header.",
      });
    } else {
      claims.set(claim, field);
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: normalized };
}

function validateMappedHeaders(
  headers: readonly string[],
  columnMap: ColumnMap | undefined,
): ColumnMapIssue[] {
  if (!columnMap) return [];
  const normalizedHeaders = headers.map((header) => header.trim().toLocaleLowerCase("en-US"));
  const issues: ColumnMapIssue[] = [];
  for (const field of CANONICAL_FIELDS) {
    const source = columnMap[field];
    if (source === undefined) continue;
    const claim = source.toLocaleLowerCase("en-US");
    const matches = normalizedHeaders.filter((header) => header === claim).length;
    if (matches === 0) {
      issues.push({
        code: "missing-header",
        field,
        message: "Mapped source header was not found in the file.",
      });
    } else if (matches > 1) {
      issues.push({
        code: "duplicate-header",
        field,
        message: "Mapped source header appears more than once in the file.",
      });
    }
  }
  return issues;
}

function resolveHeaderColumns(
  headers: readonly string[],
  columnMap: ColumnMap | undefined,
): ColumnConfig[] {
  const overrides = new Map<string, CanonicalField>();
  for (const field of CANONICAL_FIELDS) {
    const source = columnMap?.[field];
    if (source !== undefined) {
      overrides.set(source.toLocaleLowerCase("en-US"), field);
    }
  }
  const claims = headers.map((header) => {
    const key = header.trim().toLocaleLowerCase("en-US");
    const override = overrides.get(key);
    if (override) return { field: override, priority: -1 };
    for (const field of CANONICAL_FIELDS) {
      const priority = HEADER_PRIORITIES[field].indexOf(key);
      if (priority !== -1) return { field, priority };
    }
    return null;
  });

  const winners = new Map<CanonicalField, number>();
  claims.forEach((claim, index) => {
    if (!claim) return;
    const current = winners.get(claim.field);
    if (current === undefined || claim.priority < (claims[current]?.priority ?? Infinity)) {
      winners.set(claim.field, index);
    }
  });

  return headers.map((header, index) => {
    const claim = claims[index];
    if (claim && winners.get(claim.field) === index) return claim.field;
    return { name: header.trim().toLocaleLowerCase("en-US"), disabled: true };
  });
}

export function parseAmountToCents(raw: string): number | null {
  let value = raw.trim();
  if (!value) return null;
  let negative = false;
  const parenthesized = /^\((.*)\)$/.exec(value);
  if (parenthesized?.[1] !== undefined) {
    negative = true;
    value = parenthesized[1].trim();
  }
  if (value.endsWith("-")) {
    negative = true;
    value = value.slice(0, -1).trim();
  }
  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1).trim();
  } else if (value.startsWith("+")) {
    value = value.slice(1).trim();
  }
  if (/,\d{2}$/.test(value)) {
    if (value.includes(".") || value.indexOf(",") !== value.lastIndexOf(",")) return null;
    value = value.replace(",", ".");
  }
  value = value.replace(/[$€£\s,]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const cents = decimalTextToCents(value);
  if (cents === null) return null;
  if (cents === 0) return 0;
  return negative ? -cents : cents;
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

export function parseStatementDate(raw: string, dateFormat: DateFormat): string | null {
  const value = raw.trim();
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(value);
  if (!parts) return null;
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const rawYear = Number(parts[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  let format: "MDY" | "DMY";
  if (dateFormat === "auto") format = first > 12 && second <= 12 ? "DMY" : "MDY";
  else format = dateFormat;
  return format === "MDY"
    ? toIso(year, first, second)
    : toIso(year, second, first);
}

function isAmbiguousSeparatedDate(raw: string): boolean {
  const parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(raw.trim());
  if (!parts) return false;
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  return first <= 12 && second <= 12 && first !== second;
}

interface RawRecord {
  record: Record<string, string>;
  info: { lines: number };
}

function parseDebitCredit(
  rawDebit: string | undefined,
  rawCredit: string | undefined,
  rowNumber: number,
): { ok: true; amountCents: number } | { ok: false; errors: StatementRowError[] } {
  const hasDebit = rawDebit !== undefined && rawDebit !== "";
  const hasCredit = rawCredit !== undefined && rawCredit !== "";
  if (!hasDebit && !hasCredit) {
    return {
      ok: false,
      errors: [{ rowNumber, message: "No amount, debit, or credit value" }],
    };
  }

  const errors: StatementRowError[] = [];
  const debit = hasDebit ? parseAmountToCents(rawDebit) : 0;
  const credit = hasCredit ? parseAmountToCents(rawCredit) : 0;
  if (hasDebit && debit === null) errors.push({ rowNumber, message: "Unparseable debit" });
  if (hasCredit && credit === null) errors.push({ rowNumber, message: "Unparseable credit" });
  if (errors.length > 0) return { ok: false, errors };
  if (debit === null || credit === null) throw new Error("Parsed debit/credit state diverged.");

  const debitActive = debit !== 0;
  const creditActive = credit !== 0;
  if (debitActive && creditActive) {
    return {
      ok: false,
      errors: [{ rowNumber, message: "Both debit and credit contain nonzero values" }],
    };
  }
  if (debitActive) return { ok: true, amountCents: -debit };
  if (creditActive) return { ok: true, amountCents: credit };
  return { ok: true, amountCents: 0 };
}

export function parseStatementCsv(
  text: string,
  options: ParseStatementOptions = {},
): ParseStatementResult {
  const columnMapResult = validateColumnMap(options.columnMap);
  if (!columnMapResult.ok) return invalidColumnMap(columnMapResult.issues);
  const dateFormat = options.dateFormat ?? "auto";
  const errors: StatementRowError[] = [];
  const candidateRows: ParsedStatementRow[] = [];
  const ambiguousRowNumbers: number[] = [];
  let resolved: ColumnConfig[] = [];
  let rawHeaders: string[] = [];

  let records: RawRecord[];
  try {
    records = parse(text, {
      bom: true,
      columns: (headers: string[]) => {
        rawHeaders = headers.map((header) => header.trim());
        resolved = resolveHeaderColumns(headers, columnMapResult.value);
        return resolved;
      },
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
      relax_quotes: false,
      info: true,
    }) as unknown as RawRecord[];
  } catch (error) {
    const lines =
      typeof error === "object" &&
      error !== null &&
      "lines" in error &&
      Number.isSafeInteger((error as { lines?: unknown }).lines)
        ? ((error as { lines: number }).lines ?? 0)
        : 0;
    return invalidFile([{ rowNumber: lines, message: "Unparseable CSV structure" }]);
  }

  const mappedHeaderIssues = validateMappedHeaders(rawHeaders, columnMapResult.value);
  if (mappedHeaderIssues.length > 0) return invalidColumnMap(mappedHeaderIssues);

  const present = new Set(resolved.filter((column): column is CanonicalField => typeof column === "string"));
  const missing: string[] = [];
  if (!present.has("date")) missing.push("date");
  if (!present.has("description")) missing.push("description");
  if (!present.has("amount") && !present.has("debit") && !present.has("credit")) {
    missing.push("amount (or debit/credit)");
  }
  if (missing.length > 0) {
    return invalidFile([
      { rowNumber: 0, message: `Missing required column(s): ${missing.join(", ")}` },
    ]);
  }

  for (const { record, info } of records) {
    const rowNumber = info.lines;
    const rawDate = record.date;
    const rawDescription = record.description;
    if (rawDate === undefined || rawDate === "") {
      errors.push({ rowNumber, message: "Missing date" });
      continue;
    }
    const date = parseStatementDate(rawDate, dateFormat);
    if (!date) {
      errors.push({ rowNumber, message: "Unparseable date" });
      continue;
    }
    if (dateFormat === "auto" && isAmbiguousSeparatedDate(rawDate)) {
      ambiguousRowNumbers.push(rowNumber);
    }
    if (!rawDescription) {
      errors.push({ rowNumber, message: "Missing description" });
      continue;
    }

    const rawAmount = record.amount;
    let amountCents: number;
    if (rawAmount !== undefined && rawAmount !== "") {
      const parsedAmount = parseAmountToCents(rawAmount);
      if (parsedAmount === null) {
        errors.push({ rowNumber, message: "Unparseable amount" });
        continue;
      }
      amountCents = parsedAmount;
    } else {
      const result = parseDebitCredit(record.debit, record.credit, rowNumber);
      if (!result.ok) {
        errors.push(...result.errors);
        continue;
      }
      amountCents = result.amountCents;
    }

    candidateRows.push({ rowNumber, date, description: rawDescription, amountCents });
  }

  if (errors.length > 0) return invalidFile(errors);
  if (ambiguousRowNumbers.length > 0) {
    return {
      status: "date-format-required",
      rows: [],
      errors: [],
      warnings: [],
      ambiguousRowNumbers,
    };
  }
  return { status: "ready", rows: candidateRows, errors: [], warnings: [] };
}
