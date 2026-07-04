"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACCOUNT_TYPES } from "@/lib/account-types";
import { createAccount, getAccountByName } from "@/server/services/accounts";
import { setTransactionCategory } from "@/server/services/transactions";

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

const CreateAccountSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.enum(ACCOUNT_TYPES),
});

export interface CreateAccountState {
  ok: boolean;
  error?: string;
  accountId?: string;
}

export async function createAccountAction(
  _prev: CreateAccountState,
  formData: FormData,
): Promise<CreateAccountState> {
  const parsed = CreateAccountSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (await getAccountByName(parsed.data.name)) {
    return { ok: false, error: "An account with that name already exists" };
  }
  const account = await createAccount(parsed.data);
  revalidatePath("/");
  revalidatePath("/import");
  return { ok: true, accountId: account.id };
}
