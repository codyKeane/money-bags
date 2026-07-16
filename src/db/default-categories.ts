import { sql } from "drizzle-orm";
import type { Db } from "./client"; // type-only: no runtime cycle with client.ts
import { categories } from "./schema";
import { DEFAULT_CATEGORIES } from "../lib/default-categories";

type DefaultCategoryTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Installs the default category set iff the table is empty, so a user who
// imports statements without ever running the demo seed still gets working
// auto-categorization. Insert-only semantics: never overwrites user edits,
// never resurrects deleted categories (any surviving category disables it).
// The caller must already own an immediate transaction. This entry point keeps
// import bootstrap inside the import's account/batch/row rollback boundary.
export function ensureDefaultCategoriesInTransaction(
  tx: DefaultCategoryTransaction,
): void {
  const [row] = tx
    .select({ n: sql<number>`count(*)` })
    .from(categories)
    .all();
  if ((row?.n ?? 0) > 0) return;
  for (const def of DEFAULT_CATEGORIES) {
    tx.insert(categories)
      .values({
        name: def.name,
        color: def.color,
        keywords: JSON.stringify(def.keywords),
        excludeFromSpending: def.excludeFromSpending ?? false,
      })
      .run();
  }
}

// Synchronous so createDb() can call it during connection setup. Immediate
// ownership makes the empty check and complete insert set one atomic decision.
export function ensureDefaultCategories(db: Db): void {
  db.transaction(
    (tx) => ensureDefaultCategoriesInTransaction(tx),
    { behavior: "immediate" },
  );
}
