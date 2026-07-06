"use server";

import { z } from "zod";
import { parseAmountToCents } from "@/lib/csv/parse-statement";
import { CATEGORICAL_SLOTS } from "@/lib/palette";
import {
  applyRulesToUncategorized,
  createCategory,
  deleteCategory,
  getCategoryByName,
  updateCategory,
} from "@/server/services/categories";
import { firstError, requiredId, revalidateAll, type CategoryFormState } from "./shared";

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
      const cents = parseAmountToCents(trimmed);
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
  const parsed = CategorySchema.safeParse(categoryFormInput(formData));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
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
  const categoryId = requiredId(formData, "categoryId");
  if (!categoryId) return { ok: false, error: "Missing category id" };
  const parsed = CategorySchema.safeParse(categoryFormInput(formData));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
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
