"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { recategorizeAction } from "@/server/actions";

export interface CategoryOption {
  id: string;
  name: string;
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <select
      defaultValue={categoryId ?? ""}
      disabled={pending}
      aria-label="Category"
      className="rounded-md border border-hairline bg-surface px-2 py-1 text-sm text-ink-2 disabled:opacity-50"
      onChange={(event) => {
        const value = event.target.value || null;
        startTransition(async () => {
          await recategorizeAction(transactionId, value);
          router.refresh();
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
  );
}
