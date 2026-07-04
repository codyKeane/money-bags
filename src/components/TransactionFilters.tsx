"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { CategoryOption } from "@/components/CategorySelect";

const inputClass = "rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm";

// One filter row above the table; every change rewrites the URL query (and
// resets the page) so filtered views are linkable and survive reload.
export function TransactionFilters({
  accounts,
  categories,
}: {
  accounts: { id: string; name: string }[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page"); // filters change the result set — restart at page 1
    const qs = next.toString();
    router.replace(qs ? `/transactions?${qs}` : "/transactions");
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply({ q: q.trim() });
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => apply({ q: q.trim() })}
        placeholder="Search descriptions…"
        aria-label="Search descriptions"
        className={`${inputClass} w-56`}
      />
      <select
        value={params.get("account") ?? ""}
        onChange={(e) => apply({ account: e.target.value })}
        aria-label="Account"
        className={inputClass}
      >
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select
        value={params.get("category") ?? ""}
        onChange={(e) => apply({ category: e.target.value })}
        aria-label="Category"
        className={inputClass}
      >
        <option value="">All categories</option>
        <option value="uncategorized">Uncategorized</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input
        type="month"
        value={params.get("month") ?? ""}
        onChange={(e) => apply({ month: e.target.value })}
        aria-label="Month"
        className={inputClass}
      />
      {params.size > 0 ? (
        <button
          type="button"
          onClick={() => {
            setQ("");
            router.replace("/transactions");
          }}
          className="text-xs text-ink-muted underline"
        >
          Clear filters
        </button>
      ) : null}
    </form>
  );
}
