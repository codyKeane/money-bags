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
}

export interface NormalizedTransactionInput {
  accountId: string;
  categoryId: string | null;
  date: string;
  description: string;
  amountCents: number;
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
  return {
    ok: true,
    value: {
      accountId,
      categoryId,
      date: input.date,
      description,
      amountCents: input.amountCents,
    },
  };
}
