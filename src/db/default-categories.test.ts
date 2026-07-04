import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "./client";
import { categories } from "./schema";
import { ensureDefaultCategories } from "./default-categories";
import { DEFAULT_CATEGORIES } from "../lib/default-categories";
import { parseKeywords } from "../lib/categorize";

describe("ensureDefaultCategories", () => {
  let dir: string;
  let db: Db;
  let sqlite: { close(): void };

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "finance-defaults-"));
    const handle = createTestDb(path.join(dir, "test.db"));
    db = handle.db;
    sqlite = handle.sqlite;
  });

  afterAll(() => {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function count(): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)` }).from(categories);
    return row?.n ?? 0;
  }

  it("installs the full default set into an empty database", async () => {
    ensureDefaultCategories(db);
    expect(await count()).toBe(DEFAULT_CATEGORIES.length);
    const rows = await db.select().from(categories);
    for (const row of rows) {
      expect(Array.isArray(parseKeywords(row.keywords))).toBe(true);
    }
    const transfers = rows.find((r) => r.name === "Transfers");
    expect(transfers?.excludeFromSpending).toBe(true);
  });

  it("is a no-op when categories already exist", async () => {
    ensureDefaultCategories(db);
    expect(await count()).toBe(DEFAULT_CATEGORIES.length);
  });

  it("never resurrects deleted categories or overwrites edits", async () => {
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
});
