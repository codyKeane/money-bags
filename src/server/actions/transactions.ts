"use server";

import { z } from "zod";
import { centsToDecimalText, decimalTextToCents } from "@/lib/money";
import { isValidIsoDate } from "@/lib/month";
import { revalidateAfterMutation } from "@/server/revalidation";
import { assertTrustedActionOrigin } from "@/server/security/trusted-origin";
import { MAX_SPLIT_PARTS } from "@/server/services/write-validation";
import {
  createTransaction,
  deleteTransaction,
  replaceSplits,
  setTransactionCategory,
  updateTransaction,
} from "@/server/services/transactions";
import {
  firstError,
  firstFormError,
  requiredId,
  serviceFormError,
  type ActionResult,
  type TransactionFormState,
} from "./shared";

const TRANSACTION_FIELD_ALIASES = {
  amountCents: "amount",
} as const;

const EXISTING_SPLIT_MISMATCH_MESSAGE =
  "Saved split allocations do not match this transaction. Repair the split allocations or remove the split before editing it.";

const SPLIT_AMOUNT_CONFLICT_MESSAGE =
  "This transaction is split. Keep its amount unchanged, or remove the split after reviewing its allocations.";

const RecategorizeSchema = z.object({
  transactionId: z.string().min(1),
  categoryId: z.string().min(1).nullable(),
});

export async function recategorizeAction(
  transactionId: string,
  categoryId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  const parsed = RecategorizeSchema.safeParse({ transactionId, categoryId });
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const result = await setTransactionCategory(
    parsed.data.transactionId,
    parsed.data.categoryId,
  );
  if (result.status === "not-found") return { ok: false, error: "Transaction not found" };
  if (result.status === "unknown-category") return { ok: false, error: "Unknown category" };
  if (result.status === "existing-split-mismatch") {
    return { ok: false, error: EXISTING_SPLIT_MISMATCH_MESSAGE };
  }
  if (result.status === "invalid-input") return { ok: false, error: result.message };
  revalidateAfterMutation();
  return { ok: true };
}

const TransactionSchema = z.object({
  accountId: z.string().min(1, "Account is required"),
  categoryId: z
    .string()
    .default("")
    .transform((v) => v || null),
  date: z.string().refine(isValidIsoDate, "Date must be a valid YYYY-MM-DD"),
  description: z.string().trim().min(1, "Description is required").max(500),
  amount: z
    .string()
    .trim()
    .min(1, "Amount is required")
    .transform((v, ctx) => {
      const cents = decimalTextToCents(v);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: "Invalid amount" });
        return z.NEVER;
      }
      return cents;
    }),
});

function parseTransactionForm(formData: FormData) {
  const parsed = TransactionSchema.safeParse({
    accountId: formData.get("accountId"),
    categoryId: formData.get("categoryId") ?? "",
    date: formData.get("date"),
    description: formData.get("description"),
    amount: formData.get("amount"),
  });
  if (!parsed.success) return { error: firstFormError(parsed.error) } as const;
  return {
    input: {
      accountId: parsed.data.accountId,
      categoryId: parsed.data.categoryId,
      date: parsed.data.date,
      description: parsed.data.description,
      amountCents: parsed.data.amount,
    },
  } as const;
}

export async function createTransactionAction(
  _prev: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  const parsed = parseTransactionForm(formData);
  if ("error" in parsed) return { ok: false, ...parsed.error };
  const result = await createTransaction(parsed.input);
  if (result.status === "unknown-account") {
    return { ok: false, error: "Unknown account", field: "accountId" };
  }
  if (result.status === "unknown-category") {
    return { ok: false, error: "Unknown category", field: "categoryId" };
  }
  if (result.status === "invalid-input") {
    return { ok: false, ...serviceFormError(result, TRANSACTION_FIELD_ALIASES) };
  }
  revalidateAfterMutation();
  return { ok: true };
}

export async function updateTransactionAction(
  _prev: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  const transactionId = requiredId(formData, "transactionId");
  if (!transactionId) return { ok: false, error: "Missing transaction id" };
  const parsed = parseTransactionForm(formData);
  if ("error" in parsed) return { ok: false, ...parsed.error };
  const result = await updateTransaction(transactionId, parsed.input);
  if (result.status === "not-found") return { ok: false, error: "Transaction not found" };
  if (result.status === "unknown-account") {
    return { ok: false, error: "Unknown account", field: "accountId" };
  }
  if (result.status === "unknown-category") {
    return { ok: false, error: "Unknown category", field: "categoryId" };
  }
  if (result.status === "existing-split-mismatch") {
    return { ok: false, error: EXISTING_SPLIT_MISMATCH_MESSAGE };
  }
  if (result.status === "split-amount-conflict") {
    return { ok: false, error: SPLIT_AMOUNT_CONFLICT_MESSAGE };
  }
  if (result.status === "invalid-input") {
    return { ok: false, ...serviceFormError(result, TRANSACTION_FIELD_ALIASES) };
  }
  revalidateAfterMutation();
  return { ok: true };
}

export async function deleteTransactionAction(
  transactionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  if (!transactionId) return { ok: false, error: "Missing transaction id" };
  const deleted = await deleteTransaction(transactionId);
  if (!deleted) return { ok: false, error: "Transaction not found" };
  revalidateAfterMutation();
  return { ok: true };
}

// ---------- splitting a transaction across categories ----------

const SplitPartSchema = z.object({
  categoryId: z.string().min(1).nullable(),
  amountCents: z
    .number()
    .safe("Split amounts must be safe integer cents")
    .int("Split amounts must be whole cents")
    .refine((n) => n !== 0, "A split part cannot be zero"),
});

const SplitSchema = z.object({
  transactionId: z.string().min(1),
  parts: z
    .array(SplitPartSchema)
    .min(2, "A split needs at least two parts")
    .max(MAX_SPLIT_PARTS, `A split cannot contain more than ${MAX_SPLIT_PARTS} parts`),
});

// Transport validation and friendly formatting live here; the transaction
// service owns the parent/split invariant and its write transaction.
export async function splitTransactionAction(
  transactionId: string,
  parts: { categoryId: string | null; amountCents: number }[],
): Promise<ActionResult> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  const parsed = SplitSchema.safeParse({ transactionId, parts });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const result = await replaceSplits(parsed.data.transactionId, parsed.data.parts);
  if (result.status === "not-found") return { ok: false, error: "Transaction not found" };
  if (result.status === "unknown-category") {
    return { ok: false, error: "A split part points at an unknown category" };
  }
  if (result.status === "split-total-mismatch") {
    if (!Number.isSafeInteger(result.parentAmountCents)) {
      return {
        ok: false,
        error:
          "The stored transaction amount is outside the safe cents range. Remove the split only after reviewing the ledger data.",
      };
    }
    return {
      ok: false,
      error: `Split parts must add up to the transaction amount (${centsToDecimalText(result.parentAmountCents)}) — they currently total ${centsToDecimalText(result.splitTotalCents)} in the account currency.`,
    };
  }
  if (result.status === "invalid-input") return { ok: false, error: result.message };
  revalidateAfterMutation();
  return { ok: true };
}

export async function clearSplitsAction(transactionId: string): Promise<ActionResult> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  if (!transactionId) return { ok: false, error: "Missing transaction id" };
  const result = await replaceSplits(transactionId, []);
  if (result.status === "not-found") return { ok: false, error: "Transaction not found" };
  if (result.status === "unknown-category") {
    return { ok: false, error: "A split part points at an unknown category" };
  }
  if (result.status === "invalid-input") return { ok: false, error: result.message };
  if (result.status === "updated") revalidateAfterMutation();
  return { ok: true };
}
