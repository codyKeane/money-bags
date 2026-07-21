"use server";

import { z } from "zod";
import { decimalTextToCents } from "@/lib/money";
import { CATEGORICAL_SLOTS } from "@/lib/palette";
import { revalidateAfterMutation } from "@/server/revalidation";
import { assertTrustedActionOrigin } from "@/server/security/trusted-origin";
import {
  applyRulesToUncategorized,
  createCategory,
  deleteCategory,
  mergeCategory,
  updateCategory,
} from "@/server/services/categories";
import {
  firstFormError,
  requiredId,
  serviceFormError,
  type ActionResult,
  type CategoryFormState,
} from "./shared";

const CATEGORY_FIELD_ALIASES = {
  monthlyBudgetCents: "monthlyBudget",
} as const;

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
  // Dollar string → positive cents, or null when left blank (no budget).
  monthlyBudgetCents: z
    .string()
    .default("")
    .transform((v, ctx) => {
      const trimmed = v.trim();
      if (!trimmed) return null;
      const cents = decimalTextToCents(trimmed);
      if (cents === null || cents <= 0) {
        ctx.addIssue({ code: "custom", message: "Budget must be a positive amount" });
        return z.NEVER;
      }
      return cents;
    }),
});

function categoryFormInput(formData: FormData) {
  return {
    name: formData.get("name"),
    keywords: formData.get("keywords") ?? "",
    color: formData.get("color") ?? "",
    excludeFromSpending: formData.get("excludeFromSpending") === "on",
    monthlyBudgetCents: formData.get("monthlyBudget") ?? "",
  };
}

export async function createCategoryAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  const parsed = CategorySchema.safeParse(categoryFormInput(formData));
  if (!parsed.success) {
    return { ok: false, ...firstFormError(parsed.error, CATEGORY_FIELD_ALIASES) };
  }
  const result = await createCategory(parsed.data);
  if (result.status === "duplicate-name") {
    return { ok: false, error: "A category with that name already exists", field: "name" };
  }
  if (result.status === "invalid-input") {
    return { ok: false, ...serviceFormError(result, CATEGORY_FIELD_ALIASES) };
  }
  revalidateAfterMutation();
  return { ok: true };
}

export async function updateCategoryAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  const categoryId = requiredId(formData, "categoryId");
  if (!categoryId) return { ok: false, error: "Missing category id" };
  const parsed = CategorySchema.safeParse(categoryFormInput(formData));
  if (!parsed.success) {
    return { ok: false, ...firstFormError(parsed.error, CATEGORY_FIELD_ALIASES) };
  }
  const result = await updateCategory(categoryId, parsed.data);
  if (result.status === "not-found") return { ok: false, error: "Category not found" };
  if (result.status === "duplicate-name") {
    return { ok: false, error: "A category with that name already exists", field: "name" };
  }
  if (result.status === "invalid-input") {
    return { ok: false, ...serviceFormError(result, CATEGORY_FIELD_ALIASES) };
  }
  revalidateAfterMutation();
  return { ok: true };
}

export async function deleteCategoryAction(
  categoryId: string,
): Promise<{ ok: boolean; error?: string }> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  if (!categoryId) return { ok: false, error: "Missing category id" };
  const deleted = await deleteCategory(categoryId);
  if (!deleted) return { ok: false, error: "Category not found" };
  revalidateAfterMutation();
  return { ok: true };
}

export async function mergeCategoryAction(
  sourceCategoryId: string,
  targetCategoryId: string,
): Promise<ActionResult> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  const result = await mergeCategory(sourceCategoryId, targetCategoryId);
  if (result.status === "not-found") return { ok: false, error: "Category not found" };
  if (result.status === "same-category") return { ok: false, error: "Choose a different target category" };
  if (result.status === "invalid-input") return { ok: false, error: result.message };
  revalidateAfterMutation();
  return { ok: true };
}

export async function applyRulesAction(): Promise<{
  ok: boolean;
  scanned?: number;
  updated?: number;
  error?: string;
}> {
  const originFailure = await assertTrustedActionOrigin();
  if (originFailure) return originFailure;
  const result = await applyRulesToUncategorized();
  if (result.updated > 0) revalidateAfterMutation();
  return { ok: true, scanned: result.scanned, updated: result.updated };
}
