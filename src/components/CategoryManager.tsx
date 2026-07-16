"use client";

import { useId, useState } from "react";
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
  type CategoryFormState,
} from "@/server/actions";
import { CATEGORICAL_SLOTS } from "@/lib/palette";
import type { CurrencyState } from "@/lib/currency";
import { ColorDot } from "@/components/CategoryBadge";
import { centsToDecimalText, formatCents } from "@/lib/money";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { NEW_CATEGORY_FOCUS_ID } from "@/components/ui/focus-target";
import { FlashMessage, useFlash } from "@/components/ui/flash";
import { Field, FormError, buttonClass, inputClass, rowActionClass, toggleButtonClass } from "@/components/ui/form";
import { useServerForm } from "@/components/ui/use-server-form";
import { fieldErrorAttributes } from "@/components/ui/form-accessibility";
import {
  TableCard,
  bodyRowClass,
  headRowClass,
  thClass,
} from "@/components/ui/table";
import type { CategoryWithStats } from "@/server/services/categories";

const SLOT_NAMES = ["Blue", "Aqua", "Yellow", "Green", "Violet", "Red", "Magenta", "Orange"];

function ColorSelect({
  defaultValue,
  errorId,
  errorField,
}: {
  defaultValue: string | null;
  errorId: string;
  errorField?: string;
}) {
  return (
    <select
      name="color"
      defaultValue={defaultValue ?? ""}
      className={inputClass}
      {...fieldErrorAttributes(errorId, errorField, "color")}
    >
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
  currencyState,
  errorId,
  errorField,
}: {
  initial?: Pick<
    CategoryWithStats,
    "name" | "keywords" | "color" | "excludeFromSpending" | "monthlyBudgetCents"
  >;
  currencyState: CurrencyState;
  errorId: string;
  errorField?: string;
}) {
  const budgetIsSafe =
    initial?.monthlyBudgetCents == null || Number.isSafeInteger(initial.monthlyBudgetCents);
  const budgetText =
    initial?.monthlyBudgetCents != null && budgetIsSafe
      ? centsToDecimalText(initial.monthlyBudgetCents)
      : "";
  const currency = currencyState.kind === "single" ? currencyState.currency : null;
  return (
    <>
      <Field label="Name">
        <input
          name="name"
          required
          maxLength={60}
          defaultValue={initial?.name}
          className={inputClass}
          autoFocus
          {...fieldErrorAttributes(errorId, errorField, "name")}
        />
      </Field>
      <Field label="Keywords (comma-separated, matched against descriptions)">
        <input
          name="keywords"
          defaultValue={initial?.keywords.join(", ")}
          placeholder="grocery, market"
          className={inputClass}
          {...fieldErrorAttributes(errorId, errorField, "keywords")}
        />
      </Field>
      <Field label="Color">
        <ColorSelect
          defaultValue={initial?.color ?? null}
          errorId={errorId}
          errorField={errorField}
        />
      </Field>
      <Field label={`Monthly budget (optional${currency ? `, ${currency}` : ""})`}>
        {currency ? (
          <>
            <input
              name="monthlyBudget"
              inputMode="decimal"
              defaultValue={budgetText}
              placeholder="500"
              className={inputClass}
              {...fieldErrorAttributes(errorId, errorField, "monthlyBudget")}
            />
            {!budgetIsSafe ? (
              <span role="alert" className="text-xs text-delta-bad">
                The stored budget is outside the exact supported range. Enter a valid replacement
                or leave it blank to clear it.
              </span>
            ) : null}
          </>
        ) : (
          <>
            <input value={budgetText} disabled className={inputClass} />
            {budgetIsSafe ? <input type="hidden" name="monthlyBudget" value={budgetText} /> : null}
            <span className="text-xs text-ink-muted">
              Budgets are unavailable until all accounts share one valid currency.
            </span>
          </>
        )}
      </Field>
      <label className="inline-flex items-center gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          name="excludeFromSpending"
          defaultChecked={initial?.excludeFromSpending ?? false}
          {...fieldErrorAttributes(errorId, errorField, "excludeFromSpending")}
        />
        Exclude from income/spending (transfers between own accounts)
      </label>
      <p className="text-xs text-ink-muted">
        Excluded categories do not count as income or spending and do not appear
        in budget progress. A saved budget returns if you include the category later.
      </p>
    </>
  );
}

function EditRow({
  category,
  currencyState,
  onDone,
}: {
  category: CategoryWithStats;
  currencyState: CurrencyState;
  onDone: () => void;
}) {
  const hasBlockedUnsafeBudget =
    currencyState.kind !== "single" &&
    category.monthlyBudgetCents !== null &&
    !Number.isSafeInteger(category.monthlyBudgetCents);
  const errorId = `${useId()}-error`;
  const [state, formAction, pending, errorSummaryRef] =
    useServerForm<CategoryFormState>(updateCategoryAction, {
      onSuccess: onDone,
    });
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3">
      <input type="hidden" name="categoryId" value={category.id} />
      <CategoryFields
        initial={category}
        currencyState={currencyState}
        errorId={errorId}
        errorField={state.ok ? undefined : state.field}
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending || hasBlockedUnsafeBudget} className={buttonClass}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-ink-muted underline">
          Cancel
        </button>
        <FormError
          id={errorId}
          error={state.ok ? null : state.error}
          summaryRef={errorSummaryRef}
        />
      </div>
      {hasBlockedUnsafeBudget ? (
        <p role="alert" className="text-xs text-delta-bad">
          Repair account currencies first; then replace or clear this unsafe stored budget.
        </p>
      ) : null}
    </form>
  );
}

function categoryDeletionPrompt(category: CategoryWithStats): string {
  const {
    activeTransactionCount,
    activeSplitPartCount,
    ignoredParentTransactionCount,
  } = category.deletionImpact;
  const transactionsLabel = activeTransactionCount === 1 ? "transaction" : "transactions";
  const partsLabel = activeSplitPartCount === 1 ? "split allocation" : "split allocations";
  const fallbackLabel =
    ignoredParentTransactionCount === 1 ? "split transaction" : "split transactions";
  return [
    `Delete “${category.name}”? ${activeTransactionCount} ${transactionsLabel} currently use this category and will become Uncategorized; the transactions remain.`,
    `${activeSplitPartCount} ${partsLabel} will become Uncategorized.`,
    `${ignoredParentTransactionCount} ${fallbackLabel} will also lose an inactive fallback category, so it cannot return if those splits are later removed. Other categories remain.`,
  ].join(" ");
}

export function CategoryManager({
  categories,
  currencyState,
}: {
  categories: CategoryWithStats[];
  currencyState: CurrencyState;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, flash] = useFlash();
  const createErrorId = `${useId()}-create-error`;

  const [createState, createFormAction, createPending, createErrorSummaryRef] =
    useServerForm<CategoryFormState>(createCategoryAction, {
      onSuccess: () => {
        setShowCreate(false);
        flash("Category created");
      },
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          id={NEW_CATEGORY_FOCUS_ID}
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className={toggleButtonClass}
        >
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
          <CategoryFields
            currencyState={currencyState}
            errorId={createErrorId}
            errorField={createState.ok ? undefined : createState.field}
          />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={createPending} className={buttonClass}>
              {createPending ? "Creating…" : "Create category"}
            </button>
            <FormError
              id={createErrorId}
              error={createState.ok ? null : createState.error}
              summaryRef={createErrorSummaryRef}
            />
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
            <th className={`${thClass} text-right`}>Active transactions</th>
            <th className={thClass} />
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.id} className={`${bodyRowClass} align-top`}>
              {editingId === c.id ? (
                <td colSpan={6} className="px-3 py-3">
                    <EditRow
                      category={c}
                      currencyState={currencyState}
                      onDone={() => setEditingId(null)}
                    />
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
                      !Number.isSafeInteger(c.monthlyBudgetCents) ? (
                        <span className="text-delta-bad">Outside exact range</span>
                      ) : currencyState.kind === "single" ? (
                        formatCents(c.monthlyBudgetCents, currencyState.currency)
                      ) : (
                        <span className="text-ink-muted">Set — currency unavailable</span>
                      )
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
                        prompt={categoryDeletionPrompt(c)}
                        title={`Delete "${c.name}" and clear the disclosed active and fallback references`}
                        confirmLabel="Delete"
                        pendingLabel="Deleting…"
                        successFocusId={NEW_CATEGORY_FOCUS_ID}
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
