import { centsToDecimalText } from "../money";
import { isValidIsoDate } from "../month";

export const LEGACY_EXPORT_HEADER = "Date,Description,Amount,Account,Category";
export const DETAILED_EXPORT_HEADER =
  "Date,Description,Amount,Currency,Account,Category,Split Details";
export const ANNOTATED_EXPORT_HEADER = `${DETAILED_EXPORT_HEADER},Notes,Tags`;

export type TransactionExportFormat = "legacy" | "detailed" | "annotated";

export interface TransactionExportSplitDetail {
  category: string | null;
  amountCents: number;
}

export interface TransactionExportRow {
  date: string;
  description: string;
  amountCents: number;
  currency: string;
  accountName: string;
  categoryName: string | null;
  isSplit: boolean;
  splitDetails: readonly TransactionExportSplitDetail[];
  notes: string;
  tags: readonly string[];
}

const FORMULA_PREFIX = /^[\u0000-\u0020]*[=+\-@]/;
const textEncoder = new TextEncoder();

export function spreadsheetSafeText(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function safeTextField(value: string): string {
  return csvField(spreadsheetSafeText(value));
}

function compareUtf8Binary(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function serializeSplitDetails(
  details: readonly TransactionExportSplitDetail[],
): string {
  const sorted = details.map((detail) => {
    if (!Number.isSafeInteger(detail.amountCents)) {
      throw new RangeError("split amount cents must be a safe integer");
    }
    return { category: detail.category, amountCents: detail.amountCents };
  });
  sorted.sort((left, right) => {
    if (left.category === null) {
      return right.category === null ? left.amountCents - right.amountCents : 1;
    }
    if (right.category === null) return -1;
    const categoryOrder = compareUtf8Binary(left.category, right.category);
    return categoryOrder === 0 ? left.amountCents - right.amountCents : categoryOrder;
  });
  return JSON.stringify(sorted);
}

export function serializeExportRow(
  row: Readonly<TransactionExportRow>,
  format: TransactionExportFormat,
): string {
  if (!isValidIsoDate(row.date)) {
    throw new RangeError("export date must be a valid ISO date");
  }

  const amount = centsToDecimalText(row.amountCents);
  const category = row.isSplit ? "Split" : (row.categoryName ?? "Uncategorized");
  const base = [row.date, safeTextField(row.description), amount];

  if (format === "legacy") {
    return [...base, safeTextField(row.accountName), safeTextField(category)].join(",");
  }

  const splitDetails = row.isSplit ? serializeSplitDetails(row.splitDetails) : "";
  const detailed = [
    ...base,
    safeTextField(row.currency),
    safeTextField(row.accountName),
    safeTextField(category),
    safeTextField(splitDetails),
  ];
  if (format === "detailed") return detailed.join(",");
  return [
    ...detailed,
    safeTextField(row.notes),
    safeTextField(JSON.stringify(row.tags)),
  ].join(",");
}
