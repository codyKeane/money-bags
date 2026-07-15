import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { inject, describe, expect, it } from "vitest";
import { closeImplicitDb, getDb } from "@/db/client";
import { getAllCategories } from "@/server/services/categories";

function isContainedBy(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

describe("implicit Vitest database isolation", () => {
  it("opens an uninjected service only on the setup-file target", async () => {
    const root = inject("moneybagsTemporaryDatabaseRoot");
    const target = process.env.DB_FILE_NAME;
    expect(target).toBeDefined();
    expect(path.isAbsolute(target as string)).toBe(true);
    expect(isContainedBy(root, target as string)).toBe(true);
    expect(path.basename(target as string)).toBe("default.db");
    closeImplicitDb();
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      rmSync(`${target as string}${suffix}`, { force: true });
    }
    expect(existsSync(target as string)).toBe(false);

    const categories = await getAllCategories();

    expect(categories.length).toBeGreaterThan(0);
    expect(existsSync(target as string)).toBe(true);
  });

  it("closes idempotently and releases the old handle when the target changes", () => {
    const originalTarget = process.env.DB_FILE_NAME;
    if (originalTarget === undefined) throw new Error("Worker target was not installed");
    const alternateTarget = path.join(path.dirname(originalTarget), "alternate.db");

    closeImplicitDb();
    closeImplicitDb();
    const originalDb = getDb();
    process.env.DB_FILE_NAME = alternateTarget;
    try {
      const alternateDb = getDb();
      expect(alternateDb).not.toBe(originalDb);
      expect(existsSync(alternateTarget)).toBe(true);
    } finally {
      closeImplicitDb();
      process.env.DB_FILE_NAME = originalTarget;
    }
  });
});
