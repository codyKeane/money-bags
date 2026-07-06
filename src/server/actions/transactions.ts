"use server";

import { z } from "zod";
import { parseAmountToCents } from "@/lib/csv/parse-statement";
import { isValidIsoDate } from "@/lib/month";
import { getAccountById } from "@/server/services/accounts";
import { getCategoryById } from "@/server/services/categories";
import {
  createTransaction,
  deleteTransaction,
  setTransactionCategory,
  updateTransaction,
} from "@/server/services/transactions";
import { firstError, requiredId, revalidateAll, type TransactionFormState } from "./shared";

const RecategorizeSchema = z.object({
  transactionId: z.string().min(1),
  categoryId: z.string().min(1).nullable(),
});

export async function recategorizeAction(
  transactionId: string,
  categoryId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = RecategorizeSchema.safeParse({ transactionId, categoryId });
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  // Verify the target category exists before the UPDATE — otherwise a stale id
  // (e.g. a category deleted in another tab) hits a raw FK violation (F4).
  if (parsed.data.categoryId && !(await getCategoryById(parsed.data.categoryId))) {
    return { ok: false, error: "Unknown category" };
  }
  const updated = await setTransactionCategory(
    parsed.data.transactionId,
    parsed.data.categoryId,
  );
  if (!updated) return { ok: false, error: "Transaction not found" };
  revalidateAll();
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
      const cents = parseAmountToCents(v);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: "Invalid amount" });
        return z.NEVER;
      }
      return cents;
    }),
});

async function parseTransactionForm(formData: FormData) {
  const parsed = TransactionSchema.safeParse({
    accountId: formData.get("accountId"),
    categoryId: formData.get("categoryId") ?? "",
    date: formData.get("date"),
    description: formData.get("description"),
    amount: formData.get("amount"),
  });
  if (!parsed.success) return { error: firstError(parsed.error) } as const;
  // Friendly errors instead of raw FK violations.
  if (!(await getAccountById(parsed.data.accountId))) {
    return { error: "Unknown account" } as const;
  }
  if (parsed.data.categoryId && !(await getCategoryById(parsed.data.categoryId))) {
    return { error: "Unknown category" } as const;
  }
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
  const result = await parseTransactionForm(formData);
  if ("error" in result) return { ok: false, error: result.error };
  await createTransaction(result.input);
  revalidateAll();
  return { ok: true };
}

export async function updateTransactionAction(
  _prev: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const transactionId = requiredId(formData, "transactionId");
  if (!transactionId) return { ok: false, error: "Missing transaction id" };
  const result = await parseTransactionForm(formData);
  if ("error" in result) return { ok: false, error: result.error };
  const updated = await updateTransaction(transactionId, result.input);
  if (!updated) return { ok: false, error: "Transaction not found" };
  revalidateAll();
  return { ok: true };
}

export async function deleteTransactionAction(
  transactionId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!transactionId) return { ok: false, error: "Missing transaction id" };
  const deleted = await deleteTransaction(transactionId);
  if (!deleted) return { ok: false, error: "Transaction not found" };
  revalidateAll();
  return { ok: true };
}
