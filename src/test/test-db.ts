import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { createTestDb, type Db } from "@/db/client";

interface TempTestDb {
  dir: string;
  db: Db;
  sqlite: Database.Database;
}

function openTempTestDb(prefix: string): TempTestDb {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  try {
    return { dir, ...createTestDb(path.join(dir, "test.db")) };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function closeTempTestDb(handle: TempTestDb): void {
  try {
    handle.sqlite.close();
  } finally {
    rmSync(handle.dir, { recursive: true, force: true });
  }
}

// Registers a fresh migrated temp-file database for a test file and tears it
// down afterwards, replacing the ~12-line mkdtemp/createTestDb/afterAll block
// each integration test repeated (Q7). Call at the top of a describe block and
// read `ctx.db` inside beforeAll/it (it's populated once the fixture's own
// beforeAll has run).
export function setupTestDb(prefix = "finance-test-"): { readonly db: Db } {
  let handle: TempTestDb | undefined;
  beforeAll(() => {
    handle = openTempTestDb(prefix);
  });
  afterAll(() => {
    const current = handle;
    handle = undefined;
    if (current) closeTempTestDb(current);
  });
  return {
    get db() {
      if (!handle) throw new Error("Test database accessed outside its fixture lifecycle");
      return handle.db;
    },
  };
}

// Registers a new migrated temp-file database for every test. Use this for any
// suite whose tests create, update, or delete state so an exact-name run has the
// same prerequisites as a full-file run.
export function setupTestDbPerTest(prefix = "finance-test-"): { readonly db: Db } {
  let handle: TempTestDb | undefined;
  beforeEach(() => {
    handle = openTempTestDb(prefix);
  });
  afterEach(() => {
    const current = handle;
    handle = undefined;
    if (current) closeTempTestDb(current);
  });
  return {
    get db() {
      if (!handle) throw new Error("Test database accessed outside its fixture lifecycle");
      return handle.db;
    },
  };
}
