"use server";

import { z } from "zod";
import { ACCOUNT_TYPES } from "@/lib/account-types";
import { decimalTextToCents } from "@/lib/money";
import { isValidIsoDate } from "@/lib/month";
import { revalidateAfterMutation } from "@/server/revalidation";
import { assertTrustedActionOrigin } from "@/server/security/trusted-origin";
import {
  createAccount,
  deleteAccount,
  getAccountById,
  updateAccount,
} from "@/server/services/accounts";
import {
  firstFormError,
  requiredId,
  serviceFormError,
  type ActionResult,
  type CreateAccountState,
} from "./shared";

const ACCOUNT_FIELD_ALIASES = {
  openingBalanceCents: "openingBalance",
  openingBalanceDate: "openingBalanceDate",
} as const;

// Signed dollars string -> cents; empty/missing -> 0; unparseable -> null.
const openingBalanceField = z
  .string()
  .default("")
  .transform((v, ctx) => {
    const trimmed = v.trim();
    if (!trimmed) return 0;
    const cents = decimalTextToCents(trimmed);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Invalid opening balance" });
      return z.NEVER;
    }
    return cents;
  });

const openingBalanceDateField = z
  .string()
  .default("")
  .transform((value, ctx) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!isValidIsoDate(trimmed)) {
      ctx.addIssue({ code: "custom", message: "Opening balance date must be YYYY-MM-DD" });
      return z.NEVER;
    }
    return trimmed;
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
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Currency must be a three-letter code")
    .transform((v) => v.toUpperCase()),
  openingBalance: openingBalanceField,
  openingBalanceDate: openingBalanceDateField,
});

function accountFormInput(formData: FormData) {
  return {
    name: formData.get("name"),
    type: formData.get("type"),
    institution: formData.get("institution") ?? "",
    currency: formData.get("currency"),
    openingBalance: formData.get("openingBalance") ?? "",
    openingBalanceDate: formData.get("openingBalanceDate") ?? "",
  };
}

export async function createAccountAction(
  _prev: CreateAccountState,
  formData: FormData,
): Promise<CreateAccountState> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  const parsed = AccountSchema.safeParse(accountFormInput(formData));
  if (!parsed.success) return { ok: false, ...firstFormError(parsed.error) };
  const result = await createAccount({
    name: parsed.data.name,
    type: parsed.data.type,
    institution: parsed.data.institution,
    currency: parsed.data.currency,
    openingBalanceCents: parsed.data.openingBalance,
    openingBalanceDate: parsed.data.openingBalanceDate,
  });
  if (result.status === "duplicate-name") {
    return { ok: false, error: "An account with that name already exists", field: "name" };
  }
  if (result.status === "invalid-input") {
    return { ok: false, ...serviceFormError(result, ACCOUNT_FIELD_ALIASES) };
  }
  revalidateAfterMutation();
  return { ok: true, accountId: result.account.id };
}

export async function updateAccountAction(
  _prev: CreateAccountState,
  formData: FormData,
): Promise<CreateAccountState> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  const accountId = requiredId(formData, "accountId");
  if (!accountId) return { ok: false, error: "Missing account id" };
  const parsed = AccountSchema.safeParse(accountFormInput(formData));
  if (!parsed.success) return { ok: false, ...firstFormError(parsed.error) };
  const result = await updateAccount(accountId, {
    name: parsed.data.name,
    type: parsed.data.type,
    institution: parsed.data.institution,
    currency: parsed.data.currency,
    openingBalanceCents: parsed.data.openingBalance,
    openingBalanceDate: parsed.data.openingBalanceDate,
  });
  if (result.status === "not-found") return { ok: false, error: "Account not found" };
  if (result.status === "duplicate-name") {
    return { ok: false, error: "An account with that name already exists", field: "name" };
  }
  if (result.status === "invalid-input") {
    return { ok: false, ...serviceFormError(result, ACCOUNT_FIELD_ALIASES) };
  }
  revalidateAfterMutation();
  return { ok: true, accountId };
}

// Destructive: cascade-deletes the account's transactions. The typed name is
// verified SERVER-side — a client confirm alone is not the guard.
export async function deleteAccountAction(
  accountId: string,
  confirmName: string,
): Promise<ActionResult> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  const account = await getAccountById(accountId);
  if (!account) return { ok: false, error: "Account not found" };
  if (confirmName !== account.name) {
    return {
      ok: false,
      error: "Typed name does not match the account name",
      field: "confirmName",
    };
  }
  const deleted = await deleteAccount(accountId);
  if (!deleted) return { ok: false, error: "Account not found" };
  revalidateAfterMutation();
  return { ok: true };
}
