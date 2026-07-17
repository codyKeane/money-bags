"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import type { CategoryOption } from "@/components/CategorySelect";
import { inputClass } from "@/components/ui/form";

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
  // Wrapping router.replace in a transition surfaces the RSC round-trip as
  // `pending`, so a filter change shows "Updating…" instead of feeling frozen
  // while the server re-queries (UX7).
  const [pending, startTransition] = useTransition();

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page"); // filters change the result set — restart at page 1
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `/transactions?${qs}` : "/transactions");
    });
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        apply({ q: q.trim() });
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => apply({ q: q.trim() })}
        placeholder="Search descriptions, notes, or tags…"
        aria-label="Search descriptions, notes, or tags"
        className={`${inputClass} w-72`}
      />
      {params.get("tag") ? (
        <button
          type="button"
          onClick={() => apply({ tag: "" })}
          className="inline-flex min-h-11 items-center rounded-full border border-hairline bg-gridline/30 px-3 text-xs text-ink-2"
          aria-label={`Remove tag filter ${params.get("tag")}`}
        >
          #{params.get("tag")} ×
        </button>
      ) : null}
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
      <input
        type="date"
        value={params.get("from") ?? ""}
        onChange={(e) => apply({ from: e.target.value })}
        aria-label="From date"
        title="From date"
        className={inputClass}
      />
      <input
        type="date"
        value={params.get("to") ?? ""}
        onChange={(e) => apply({ to: e.target.value })}
        aria-label="To date"
        title="To date"
        className={inputClass}
      />
      {params.size > 0 ? (
        <button
          type="button"
          onClick={() => {
            setQ("");
            startTransition(() => router.replace("/transactions"));
          }}
          className="inline-flex min-h-11 items-center text-xs text-ink-muted underline"
        >
          Clear filters
        </button>
      ) : null}
      <span role="status" aria-live="polite" className="text-xs text-ink-muted">
        {pending ? "Updating…" : ""}
      </span>
    </form>
  );
}
