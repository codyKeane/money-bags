import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";
import { createTestDb, type Db } from "@/db/client";

// Registers a fresh migrated temp-file database for a test file and tears it
// down afterwards, replacing the ~12-line mkdtemp/createTestDb/afterAll block
// each integration test repeated (Q7). Call at the top of a describe block and
// read `ctx.db` inside beforeAll/it (it's populated once the fixture's own
// beforeAll has run).
export function setupTestDb(prefix = "finance-test-"): { readonly db: Db } {
  let dir: string;
  let db: Db;
  let sqlite: Database.Database;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), prefix));
    const handle = createTestDb(path.join(dir, "test.db"));
    db = handle.db;
    sqlite = handle.sqlite;
  });
  afterAll(() => {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get db() {
      return db;
    },
  };
}
