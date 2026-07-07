"use client";

import { useState } from "react";
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
  type CategoryFormState,
} from "@/server/actions";
import { CATEGORICAL_SLOTS } from "@/lib/palette";
import { ColorDot } from "@/components/CategoryBadge";
import { formatCents } from "@/lib/money";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { FlashMessage, useFlash } from "@/components/ui/flash";
import { Field, FormError, buttonClass, inputClass, rowActionClass, toggleButtonClass } from "@/components/ui/form";
import { useServerForm } from "@/components/ui/use-server-form";
import {
  TableCard,
  bodyRowClass,
  headRowClass,
  thClass,
} from "@/components/ui/table";
import type { CategoryWithStats } from "@/server/services/categories";

const SLOT_NAMES = ["Blue", "Aqua", "Yellow", "Green", "Violet", "Red", "Magenta", "Orange"];

function ColorSelect({ defaultValue }: { defaultValue: string | null }) {
  return (
    <select name="color" defaultValue={defaultValue ?? ""} className={inputClass}>
      <option value="">None</option>
      {CATEGORICAL_SLOTS.map((slot, i) => (
        <option key={slot.light} value={slot.light}>
          {SLOT_NAMES[i]}
        </option>
      ))}
    </select>
  );
}

function CategoryFields({
  initial,
}: {
  initial?: Pick<
    CategoryWithStats,
    "name" | "keywords" | "color" | "excludeFromSpending" | "monthlyBudgetCents"
  >;
}) {
  return (
    <>
      <Field label="Name">
        <input name="name" required maxLength={60} defaultValue={initial?.name} className={inputClass} autoFocus />
      </Field>
      <Field label="Keywords (comma-separated, matched against descriptions)">
        <input
          name="keywords"
          defaultValue={initial?.keywords.join(", ")}
          placeholder="grocery, market"
          className={inputClass}
        />
      </Field>
      <Field label="Color">
        <ColorSelect defaultValue={initial?.color ?? null} />
      </Field>
      <Field label="Monthly budget (optional, in dollars)">
        <input
          name="monthlyBudget"
          inputMode="decimal"
          defaultValue={
            initial?.monthlyBudgetCents != null
              ? (initial.monthlyBudgetCents / 100).toString()
              : ""
          }
          placeholder="500"
          className={inputClass}
        />
      </Field>
      <label className="inline-flex items-center gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          name="excludeFromSpending"
          defaultChecked={initial?.excludeFromSpending ?? false}
        />
        Exclude from income/spending (transfers between own accounts)
      </label>
    </>
  );
}

function EditRow({ category, onDone }: { category: CategoryWithStats; onDone: () => void }) {
  const [state, formAction, pending] = useServerForm<CategoryFormState>(updateCategoryAction, {
    onSuccess: onDone,
  });
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3">
      <input type="hidden" name="categoryId" value={category.id} />
      <CategoryFields initial={category} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-ink-muted underline">
          Cancel
        </button>
        <FormError error={state.ok ? null : state.error} />
      </div>
    </form>
  );
}

export function CategoryManager({ categories }: { categories: CategoryWithStats[] }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, flash] = useFlash();

  const [createState, createFormAction, createPending] = useServerForm<CategoryFormState>(
    createCategoryAction,
    {
      onSuccess: () => {
        setShowCreate(false);
        flash("Category created");
      },
    },
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setShowCreate((v) => !v)} className={toggleButtonClass}>
          {showCreate ? "Cancel" : "New category"}
        </button>
        <FlashMessage message={message} />
      </div>

      {showCreate ? (
        <form
          action={createFormAction}
          className="flex max-w-xl flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3"
        >
          <p className="text-sm font-medium">New category</p>
          <CategoryFields />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={createPending} className={buttonClass}>
              {createPending ? "Creating…" : "Create category"}
            </button>
            <FormError error={createState.ok ? null : createState.error} />
          </div>
        </form>
      ) : null}

      <TableCard>
        <thead>
          <tr className={headRowClass}>
            <th className={thClass}>Category</th>
            <th className={thClass}>Keywords</th>
            <th className={`${thClass} text-right`}>Budget</th>
            <th className={thClass}>Excluded</th>
            <th className={`${thClass} text-right`}>Transactions</th>
            <th className={thClass} />
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.id} className={`${bodyRowClass} align-top`}>
              {editingId === c.id ? (
                <td colSpan={6} className="px-3 py-3">
                  <EditRow category={c} onDone={() => setEditingId(null)} />
                </td>
              ) : (
                <>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <ColorDot color={c.color} />
                      {c.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-2">
                    {c.keywords.length > 0 ? c.keywords.join(", ") : <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                    {c.monthlyBudgetCents != null ? (
                      formatCents(c.monthlyBudgetCents)
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-2">{c.excludeFromSpending ? "Yes" : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.transactionCount}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <span className="inline-flex items-center gap-3">
                      <button type="button" onClick={() => setEditingId(c.id)} className={rowActionClass}>
                        Edit
                      </button>
                      <ConfirmButton
                        label="Delete"
                        prompt="Delete?"
                        title={`Delete "${c.name}" — its ${c.transactionCount} transactions become Uncategorized`}
                        confirmLabel="Delete"
                        pendingLabel="Deleting…"
                        onConfirm={async () => {
                          const res = await deleteCategoryAction(c.id);
                          if (!res.ok) return res.error ?? "Delete failed";
                        }}
                      />
                    </span>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </TableCard>
    </div>
  );
}
