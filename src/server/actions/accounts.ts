"use server";

import { z } from "zod";
import { ACCOUNT_TYPES } from "@/lib/account-types";
import { parseAmountToCents } from "@/lib/csv/parse-statement";
import {
  createAccount,
  deleteAccount,
  getAccountById,
  getAccountByName,
  updateAccount,
} from "@/server/services/accounts";
import {
  firstError,
  requiredId,
  revalidateAll,
  type CreateAccountState,
} from "./shared";

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

export async function createAccountAction(
  _prev: CreateAccountState,
  formData: FormData,
): Promise<CreateAccountState> {
  const parsed = AccountSchema.safeParse(accountFormInput(formData));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  if (await getAccountByName(parsed.data.name)) {
    return { ok: false, error: "An account with that name already exists" };
  }
  const account = await createAccount({
    name: parsed.data.name,
    type: parsed.data.type,
    institution: parsed.data.institution,
    openingBalanceCents: parsed.data.openingBalance,
  });
  revalidateAll();
  return { ok: true, accountId: account.id };
}

export async function updateAccountAction(
  _prev: CreateAccountState,
  formData: FormData,
): Promise<CreateAccountState> {
  const accountId = requiredId(formData, "accountId");
  if (!accountId) return { ok: false, error: "Missing account id" };
  const parsed = AccountSchema.safeParse(accountFormInput(formData));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
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
  return { ok: true };
}
