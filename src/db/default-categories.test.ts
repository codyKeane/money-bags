import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "./client";
import { setupTestDbPerTest } from "@/test/test-db";
import { categories } from "./schema";
import { ensureDefaultCategories } from "./default-categories";
import { DEFAULT_CATEGORIES } from "../lib/default-categories";
import { parseKeywords } from "../lib/categorize";

describe("ensureDefaultCategories", () => {
  const ctx = setupTestDbPerTest("finance-defaults-");
  let db: Db;

  beforeEach(() => {
    db = ctx.db;
  });

  async function count(): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)` }).from(categories);
    return row?.n ?? 0;
  }

  it("installs the full default set into an empty database", async () => {
    ensureDefaultCategories(db);
    expect(await count()).toBe(DEFAULT_CATEGORIES.length);
    const rows = await db.select().from(categories);
    expect(
      rows
        .map((row) => ({
          name: row.name,
          color: row.color,
          keywords: parseKeywords(row.keywords),
          excludeFromSpending: row.excludeFromSpending,
          monthlyBudgetCents: row.monthlyBudgetCents,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual(
      DEFAULT_CATEGORIES.map((def) => ({
        name: def.name,
        color: def.color,
        keywords: [...def.keywords],
        excludeFromSpending: def.excludeFromSpending ?? false,
        monthlyBudgetCents: null,
      })).sort((a, b) => a.name.localeCompare(b.name)),
    );
  });

  it("uses the installed immediate transaction API", () => {
    const transaction = vi.spyOn(db, "transaction");
    ensureDefaultCategories(db);
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction.mock.calls[0]?.[1]).toEqual({ behavior: "immediate" });
  });

  it("rolls back a failed fifth insert and installs all defaults on retry", async () => {
    db.run(sql.raw(`
      CREATE TRIGGER abort_fifth_default
      BEFORE INSERT ON categories
      WHEN (SELECT count(*) FROM categories) = 4
      BEGIN
        SELECT RAISE(ABORT, 'synthetic default-category failure');
      END
    `));

    expect(() => ensureDefaultCategories(db)).toThrow("synthetic default-category failure");
    expect(await count()).toBe(0);

    db.run(sql.raw("DROP TRIGGER abort_fifth_default"));
    ensureDefaultCategories(db);
    expect(await count()).toBe(DEFAULT_CATEGORIES.length);
  });

  it("is a no-op when categories already exist", async () => {
    ensureDefaultCategories(db);
    ensureDefaultCategories(db);
    expect(await count()).toBe(DEFAULT_CATEGORIES.length);
  });

  it("never resurrects deleted categories or overwrites edits", async () => {
    ensureDefaultCategories(db);
    await db
      .update(categories)
      .set({ keywords: JSON.stringify(["custom"]) })
      .where(eq(categories.name, "Groceries"));
    await db.delete(categories).where(eq(categories.name, "Health"));
    ensureDefaultCategories(db);
    expect(await count()).toBe(DEFAULT_CATEGORIES.length - 1);
    const [groceries] = await db
      .select()
      .from(categories)
      .where(eq(categories.name, "Groceries"));
    expect(parseKeywords(groceries?.keywords ?? "[]")).toEqual(["custom"]);
  });

  it("leaves a historically partial category table exactly unchanged", async () => {
    db.insert(categories)
      .values({
        id: "historical-category",
        name: "Historical custom category",
        color: "#123456",
        keywords: JSON.stringify(["custom"]),
        excludeFromSpending: true,
        monthlyBudgetCents: 12345,
        createdAt: 123456789,
      })
      .run();
    const before = await db.select().from(categories);

    ensureDefaultCategories(db);

    expect(await db.select().from(categories)).toEqual(before);
  });

  it("reinstalls the full defaults after the table becomes completely empty", async () => {
    ensureDefaultCategories(db);
    await db.delete(categories);

    ensureDefaultCategories(db);

    expect(await count()).toBe(DEFAULT_CATEGORIES.length);
  });
});
