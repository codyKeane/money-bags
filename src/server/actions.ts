"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACCOUNT_TYPES } from "@/lib/account-types";
import { parseAmountToCents } from "@/lib/csv/parse-statement";
import { CATEGORICAL_SLOTS } from "@/lib/palette";
import {
  createAccount,
  deleteAccount,
  getAccountById,
  getAccountByName,
  updateAccount,
} from "@/server/services/accounts";
import {
  applyRulesToUncategorized,
  createCategory,
  deleteCategory,
  getCategoryById,
  getCategoryByName,
  updateCategory,
} from "@/server/services/categories";
import {
  createTransaction,
  deleteTransaction,
  setTransactionCategory,
  updateTransaction,
} from "@/server/services/transactions";
import { isValidIsoDate } from "@/lib/month";

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/categories");
}

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
  const updated = await setTransactionCategory(
    parsed.data.transactionId,
    parsed.data.categoryId,
  );
  if (!updated) return { ok: false, error: "Transaction not found" };
  revalidatePath("/");
  revalidatePath("/transactions");
  return { ok: true };
}

// Signed dollars string -> cents; empty/missing -> 0; unparseable -> null.
const openingBalanceField = z
  .string()
  .default("")
  .transform((v, ctx) => {
    const trimmed = v.trim();
    if (!trimmed) return 0;
    const cents = parseAmountToCents(trimmed);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Invalid opening balance" });
      return z.NEVER;
    }
    return cents;
  });

const AccountSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.enum(ACCOUNT_TYPES),
  institution: z
    .string()
    .trim()
    .max(120)
    .default("")
    .transform((v) => v || null),
  openingBalance: openingBalanceField,
});

function accountFormInput(formData: FormData) {
  return {
    name: formData.get("name"),
    type: formData.get("type"),
    institution: formData.get("institution") ?? "",
    openingBalance: formData.get("openingBalance") ?? "",
  };
}

export interface CreateAccountState {
  ok: boolean;
  error?: string;
  accountId?: string;
}

export async function createAccountAction(
  _prev: CreateAccountState,
  formData: FormData,
): Promise<CreateAccountState> {
  const parsed = AccountSchema.safeParse(accountFormInput(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (await getAccountByName(parsed.data.name)) {
    return { ok: false, error: "An account with that name already exists" };
  }
  const account = await createAccount({
    name: parsed.data.name,
    type: parsed.data.type,
    institution: parsed.data.institution,
    openingBalanceCents: parsed.data.openingBalance,
  });
  revalidatePath("/");
  revalidatePath("/import");
  revalidatePath("/accounts");
  return { ok: true, accountId: account.id };
}

export async function updateAccountAction(
  _prev: CreateAccountState,
  formData: FormData,
): Promise<CreateAccountState> {
  const accountId = formData.get("accountId");
  if (typeof accountId !== "string" || !accountId) {
    return { ok: false, error: "Missing account id" };
  }
  const parsed = AccountSchema.safeParse(accountFormInput(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const existing = await getAccountByName(parsed.data.name);
  if (existing && existing.id !== accountId) {
    return { ok: false, error: "An account with that name already exists" };
  }
  const updated = await updateAccount(accountId, {
    name: parsed.data.name,
    type: parsed.data.type,
    institution: parsed.data.institution,
    openingBalanceCents: parsed.data.openingBalance,
  });
  if (!updated) return { ok: false, error: "Account not found" };
  revalidateAll();
  revalidatePath("/accounts");
  return { ok: true, accountId };
}

// Destructive: cascade-deletes the account's transactions. The typed name is
// verified SERVER-side — a client confirm alone is not the guard.
export async function deleteAccountAction(
  accountId: string,
  confirmName: string,
): Promise<{ ok: boolean; error?: string }> {
  const account = await getAccountById(accountId);
  if (!account) return { ok: false, error: "Account not found" };
  if (confirmName !== account.name) {
    return { ok: false, error: "Typed name does not match the account name" };
  }
  await deleteAccount(accountId);
  revalidateAll();
  revalidatePath("/accounts");
  revalidatePath("/import");
  return { ok: true };
}

// ---------- categories ----------

const VALID_COLORS = new Set(CATEGORICAL_SLOTS.map((s) => s.light));

const CategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  keywords: z
    .string()
    .default("")
    .transform((s) => [
      ...new Set(
        s
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean),
      ),
    ]),
  color: z
    .string()
    .default("")
    .transform((v) => v || null)
    .refine((v) => v === null || VALID_COLORS.has(v), "Unknown color"),
  excludeFromSpending: z.coerce.boolean().default(false),
});

export interface CategoryFormState {
  ok: boolean;
  error?: string;
}

export async function createCategoryAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const parsed = CategorySchema.safeParse({
    name: formData.get("name"),
    keywords: formData.get("keywords") ?? "",
    color: formData.get("color") ?? "",
    excludeFromSpending: formData.get("excludeFromSpending") === "on",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (await getCategoryByName(parsed.data.name)) {
    return { ok: false, error: "A category with that name already exists" };
  }
  await createCategory(parsed.data);
  revalidateAll();
  return { ok: true };
}

export async function updateCategoryAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const categoryId = formData.get("categoryId");
  if (typeof categoryId !== "string" || !categoryId) {
    return { ok: false, error: "Missing category id" };
  }
  const parsed = CategorySchema.safeParse({
    name: formData.get("name"),
    keywords: formData.get("keywords") ?? "",
    color: formData.get("color") ?? "",
    excludeFromSpending: formData.get("excludeFromSpending") === "on",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const existing = await getCategoryByName(parsed.data.name);
  if (existing && existing.id !== categoryId) {
    return { ok: false, error: "A category with that name already exists" };
  }
  const updated = await updateCategory(categoryId, parsed.data);
  if (!updated) return { ok: false, error: "Category not found" };
  revalidateAll();
  return { ok: true };
}

export async function deleteCategoryAction(
  categoryId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!categoryId) return { ok: false, error: "Missing category id" };
  const deleted = await deleteCategory(categoryId);
  if (!deleted) return { ok: false, error: "Category not found" };
  revalidateAll();
  return { ok: true };
}

export async function applyRulesAction(): Promise<{
  ok: boolean;
  scanned?: number;
  updated?: number;
  error?: string;
}> {
  const result = await applyRulesToUncategorized();
  revalidateAll();
  return { ok: true, ...result };
}

// ---------- manual transactions ----------

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

export interface TransactionFormState {
  ok: boolean;
  error?: string;
}

async function parseTransactionForm(formData: FormData) {
  const parsed = TransactionSchema.safeParse({
    accountId: formData.get("accountId"),
    categoryId: formData.get("categoryId") ?? "",
    date: formData.get("date"),
    description: formData.get("description"),
    amount: formData.get("amount"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" } as const;
  }
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
  const transactionId = formData.get("transactionId");
  if (typeof transactionId !== "string" || !transactionId) {
    return { ok: false, error: "Missing transaction id" };
  }
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
