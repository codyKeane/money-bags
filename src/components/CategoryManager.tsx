"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
  type CategoryFormState,
} from "@/server/actions";
import { CATEGORICAL_SLOTS, darkVariant } from "@/lib/palette";
import type { CategoryWithStats } from "@/server/services/categories";

const inputClass = "rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm";

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

function ColorDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 rounded-full"
      style={
        color
          ? ({ backgroundColor: color, "--dot-dark": darkVariant(color) } as React.CSSProperties)
          : { backgroundColor: "var(--ink-muted)" }
      }
      data-has-color={color ? "" : undefined}
    />
  );
}

function CategoryFields({
  initial,
}: {
  initial?: Pick<CategoryWithStats, "name" | "keywords" | "color" | "excludeFromSpending">;
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Name</span>
        <input name="name" required maxLength={60} defaultValue={initial?.name} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Keywords (comma-separated, matched against descriptions)</span>
        <input
          name="keywords"
          defaultValue={initial?.keywords.join(", ")}
          placeholder="grocery, market"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Color</span>
        <ColorSelect defaultValue={initial?.color ?? null} />
      </label>
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
  const [state, formAction, pending] = useActionState(
    async (prev: CategoryFormState, formData: FormData) => {
      const result = await updateCategoryAction(prev, formData);
      if (result.ok) onDone();
      return result;
    },
    { ok: true },
  );
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3">
      <input type="hidden" name="categoryId" value={category.id} />
      <CategoryFields initial={category} />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-hairline px-3 py-1 text-sm hover:bg-gridline/40 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-ink-muted underline">
          Cancel
        </button>
        {!state.ok && state.error ? <span className="text-sm text-ink-2">⚠ {state.error}</span> : null}
      </div>
    </form>
  );
}

export function CategoryManager({ categories }: { categories: CategoryWithStats[] }) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletePending, startDelete] = useTransition();

  const [createState, createFormAction, createPending] = useActionState(
    async (prev: CategoryFormState, formData: FormData) => {
      const result = await createCategoryAction(prev, formData);
      if (result.ok) {
        setShowCreate(false);
        router.refresh();
      }
      return result;
    },
    { ok: true },
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-md border border-hairline bg-surface px-3 py-1 text-sm font-medium hover:bg-gridline/40"
        >
          {showCreate ? "Cancel" : "New category"}
        </button>
      </div>

      {showCreate ? (
        <form
          action={createFormAction}
          className="flex max-w-xl flex-col gap-3 rounded-lg border border-hairline bg-surface px-4 py-3"
        >
          <p className="text-sm font-medium">New category</p>
          <CategoryFields />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={createPending}
              className="rounded-md border border-hairline px-3 py-1 text-sm hover:bg-gridline/40 disabled:opacity-50"
            >
              {createPending ? "Creating…" : "Create category"}
            </button>
            {!createState.ok && createState.error ? (
              <span className="text-sm text-ink-2">⚠ {createState.error}</span>
            ) : null}
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-ink-muted">
              <th className="px-3 py-2 font-normal">Category</th>
              <th className="px-3 py-2 font-normal">Keywords</th>
              <th className="px-3 py-2 font-normal">Excluded</th>
              <th className="px-3 py-2 text-right font-normal">Transactions</th>
              <th className="px-3 py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} className="border-b border-hairline last:border-b-0 align-top">
                {editingId === c.id ? (
                  <td colSpan={5} className="px-3 py-3">
                    <EditRow
                      category={c}
                      onDone={() => {
                        setEditingId(null);
                        router.refresh();
                      }}
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
                    <td className="px-3 py-2 text-ink-2">{c.excludeFromSpending ? "Yes" : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.transactionCount}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => setEditingId(c.id)}
                        className="text-xs text-ink-2 underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={deletePending}
                        className="ml-3 text-xs text-ink-2 underline disabled:opacity-50"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete "${c.name}"? Its ${c.transactionCount} transactions become Uncategorized.`,
                            )
                          )
                            return;
                          startDelete(async () => {
                            await deleteCategoryAction(c.id);
                            router.refresh();
                          });
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
