import { isAccountType, type AccountType } from "../../lib/account-types";
export { normalizeCurrencyCode } from "../../lib/currency";
import { isValidIsoDate } from "../../lib/month";
import { CATEGORICAL_SLOTS } from "../../lib/palette";

export const WRITE_LIMITS = {
  id: 200,
  accountName: 120,
  categoryName: 60,
  description: 500,
  filename: 255,
  institution: 120,
  keyword: 120,
  keywords: 100,
  transactionNotes: 2_000,
  transactionTag: 40,
  transactionTags: 20,
  transactionTagsJson: 1_024,
} as const;

// Three bound values are inserted per split row. Staying at 250 keeps a bulk
// insert below SQLite's conservative 999-variable compatibility ceiling while
// still far exceeding a practical manual allocation.
export const MAX_SPLIT_PARTS = 250;

const VALID_CATEGORY_COLORS = new Set(CATEGORICAL_SLOTS.map((slot) => slot.light));

export interface InvalidWriteInput {
  status: "invalid-input";
  field: string;
  message: string;
}

export function invalidWriteInput(field: string, message: string): InvalidWriteInput {
  return { status: "invalid-input", field, message };
}

export function isSafeCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function isValidLedgerDate(value: unknown): value is string {
  return typeof value === "string" && isValidIsoDate(value);
}

export function isValidBudgetCents(value: unknown): value is number | null {
  return value === null || (isSafeCents(value) && value > 0);
}

export function normalizeRequiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

export function normalizeId(value: unknown): string | null {
  return normalizeRequiredText(value, WRITE_LIMITS.id);
}

export function normalizeAccountName(value: unknown): string | null {
  return normalizeRequiredText(value, WRITE_LIMITS.accountName);
}

export function normalizeCategoryName(value: unknown): string | null {
  return normalizeRequiredText(value, WRITE_LIMITS.categoryName);
}

export function normalizeDescription(value: unknown): string | null {
  return normalizeRequiredText(value, WRITE_LIMITS.description);
}

function hasUnsafeCodePoint(value: string, allowedControls: ReadonlySet<number>): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      (codePoint <= 0x1f && !allowedControls.has(codePoint)) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      UNSAFE_FORMATTING.has(codePoint)
    ) {
      return true;
    }
  }
  return false;
}

const NOTE_CONTROLS = new Set([0x09, 0x0a]);
const NO_CONTROLS = new Set<number>();
const UNSAFE_FORMATTING = new Set([
  0x061c,
  0x200e,
  0x200f,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
  0xfeff,
]);

export function normalizeTransactionNotes(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
  if (
    [...normalized].length > WRITE_LIMITS.transactionNotes ||
    hasUnsafeCodePoint(normalized, NOTE_CONTROLS)
  ) {
    return null;
  }
  return normalized;
}

export function normalizeTransactionTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > WRITE_LIMITS.transactionTags) return null;

  const normalized = new Set<string>();
  for (const rawTag of value) {
    if (typeof rawTag !== "string") return null;
    const nfc = rawTag.normalize("NFC");
    if (nfc.includes(",") || hasUnsafeCodePoint(nfc, NO_CONTROLS)) return null;
    const tag = nfc.trim().replace(/\s+/gu, " ").toLowerCase();
    if (!tag) continue;
    if ([...tag].length > WRITE_LIMITS.transactionTag) return null;
    normalized.add(tag);
  }

  const tags = [...normalized].sort();
  if (tags.length > WRITE_LIMITS.transactionTags) return null;
  if (JSON.stringify(tags).length > WRITE_LIMITS.transactionTagsJson) return null;
  return tags;
}

export function parseStoredTransactionTags(value: unknown): string[] {
  if (typeof value !== "string" || value.length > WRITE_LIMITS.transactionTagsJson) {
    return [];
  }
  try {
    return normalizeTransactionTags(JSON.parse(value)) ?? [];
  } catch {
    return [];
  }
}

export function normalizeFilename(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const basename = value.split(/[\\/]/).at(-1);
  if (basename === undefined || basename.length === 0) return null;

  const normalized = basename.normalize("NFC");
  const codePoints = [...normalized];
  if (
    codePoints.length === 0 ||
    codePoints.length > WRITE_LIMITS.filename ||
    normalized === "." ||
    normalized === ".."
  ) {
    return null;
  }
  for (const character of codePoints) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return null;
    }
  }
  return normalized;
}

export function normalizeInstitution(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length <= WRITE_LIMITS.institution ? normalized : undefined;
}

export function normalizeAccountType(value: unknown): AccountType | null {
  return typeof value === "string" && isAccountType(value) ? value : null;
}

export function normalizeCategoryColor(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && VALID_CATEGORY_COLORS.has(value) ? value : undefined;
}

export function normalizeKeywords(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > WRITE_LIMITS.keywords) return null;

  const normalized = new Set<string>();
  for (const keyword of value) {
    if (typeof keyword !== "string") return null;
    const next = keyword.trim().toLowerCase();
    if (!next) continue;
    if (next.length > WRITE_LIMITS.keyword) return null;
    normalized.add(next);
  }
  return [...normalized];
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export interface TransactionInput {
  accountId: string;
  categoryId: string | null;
  date: string;
  description: string;
  amountCents: number;
  notes?: string;
  tags?: readonly string[];
}

export interface NormalizedTransactionInput {
  accountId: string;
  categoryId: string | null;
  date: string;
  description: string;
  amountCents: number;
  notes?: string;
  tagsJson?: string;
}

export function normalizeTransactionInput(
  input: TransactionInput,
):
  | { ok: true; value: NormalizedTransactionInput }
  | { ok: false; result: InvalidWriteInput } {
  const accountId = normalizeId(input.accountId);
  if (!accountId) {
    return { ok: false, result: invalidWriteInput("accountId", "Invalid account id") };
  }
  const categoryId = input.categoryId === null ? null : normalizeId(input.categoryId);
  if (input.categoryId !== null && !categoryId) {
    return { ok: false, result: invalidWriteInput("categoryId", "Invalid category id") };
  }
  if (!isValidLedgerDate(input.date)) {
    return { ok: false, result: invalidWriteInput("date", "Invalid ledger date") };
  }
  const description = normalizeDescription(input.description);
  if (!description) {
    return {
      ok: false,
      result: invalidWriteInput(
        "description",
        "Transaction description must be 1 to 500 characters",
      ),
    };
  }
  if (!isSafeCents(input.amountCents)) {
    return {
      ok: false,
      result: invalidWriteInput("amountCents", "Transaction amount must be exact cents"),
    };
  }
  const notes =
    input.notes === undefined ? undefined : normalizeTransactionNotes(input.notes);
  if (notes === null) {
    return {
      ok: false,
      result: invalidWriteInput(
        "notes",
        `Transaction notes must be at most ${WRITE_LIMITS.transactionNotes} characters and contain only safe text`,
      ),
    };
  }
  const tags = input.tags === undefined ? undefined : normalizeTransactionTags(input.tags);
  if (tags === null) {
    return {
      ok: false,
      result: invalidWriteInput(
        "tags",
        `Use at most ${WRITE_LIMITS.transactionTags} comma-free tags of ${WRITE_LIMITS.transactionTag} characters each`,
      ),
    };
  }
  return {
    ok: true,
    value: {
      accountId,
      categoryId,
      date: input.date,
      description,
      amountCents: input.amountCents,
      ...(notes === undefined ? {} : { notes }),
      ...(tags === undefined ? {} : { tagsJson: JSON.stringify(tags) }),
    },
  };
}
