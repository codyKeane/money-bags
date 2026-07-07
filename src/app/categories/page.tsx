import { ApplyRulesButton } from "@/components/ApplyRulesButton";
import { CategoryManager } from "@/components/CategoryManager";
import { getCategoriesWithStats } from "@/server/services/categories";

export const dynamic = "force-dynamic";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const categories = await getCategoriesWithStats();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Categories</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Keywords auto-categorize imported transactions (longest match
            wins). Rules apply at import; use the button to re-run them over
            uncategorized rows.
          </p>
        </div>
        <ApplyRulesButton />
      </div>
      <CategoryManager categories={categories} />
    </div>
  );
}
