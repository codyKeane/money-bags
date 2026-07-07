"use client";

import { useState, useTransition } from "react";
import { ColorDot } from "@/components/CategoryBadge";
import { recategorizeAction } from "@/server/actions";

export interface CategoryOption {
  id: string;
  name: string;
  color?: string | null;
}

export function CategorySelect({
  transactionId,
  categoryId,
  categories,
}: {
  transactionId: string;
  categoryId: string | null;
  categories: CategoryOption[];
}) {
  const [pending, startTransition] = useTransition();
  // Controlled so the dot beside the select tracks the live selection (UX18) —
  // a native <select> can't paint per-option swatches, so the dot sits outside.
  const [value, setValue] = useState(categoryId ?? "");
  const selected = categories.find((c) => c.id === value);

  return (
    <span className="inline-flex items-center gap-1.5">
      <ColorDot color={selected?.color ?? null} />
      <select
        value={value}
        disabled={pending}
        aria-label="Category"
        className="min-h-11 rounded-md border border-hairline bg-surface px-2 py-1 text-sm text-ink-2 disabled:opacity-50"
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          // The action revalidates /transactions, so the server re-renders this
          // route in the action response — no router.refresh() needed (P2).
          startTransition(async () => {
            await recategorizeAction(transactionId, next || null);
          });
        }}
      >
        <option value="">Uncategorized</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </span>
  );
}
