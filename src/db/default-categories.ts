import { sql } from "drizzle-orm";
import type { Db } from "./client"; // type-only: no runtime cycle with client.ts
import { categories } from "./schema";
import { DEFAULT_CATEGORIES } from "../lib/default-categories";

// Installs the default category set iff the table is empty, so a user who
// imports statements without ever running the demo seed still gets working
// auto-categorization. Insert-only semantics: never overwrites user edits,
// never resurrects deleted categories (any surviving category disables it).
// Synchronous so createDb() can call it during connection setup.
export function ensureDefaultCategories(db: Db): void {
  const [row] = db
    .select({ n: sql<number>`count(*)` })
    .from(categories)
    .all();
  if ((row?.n ?? 0) > 0) return;
  for (const def of DEFAULT_CATEGORIES) {
    db.insert(categories)
      .values({
        name: def.name,
        color: def.color,
        keywords: JSON.stringify(def.keywords),
        excludeFromSpending: def.excludeFromSpending ?? false,
      })
      .onConflictDoNothing({ target: categories.name })
      .run();
  }
}
