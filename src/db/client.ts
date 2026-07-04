import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

// Single source of truth for the DB file location. All entry points (Next
// server, CLI scripts, seed) run via npm scripts with cwd = project root, so
// the relative DB_FILE_NAME resolves to the same absolute file everywhere.
export function resolveDbPath(): string {
  const configured = process.env.DB_FILE_NAME ?? "data/finance.db";
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

export type Db = BetterSQLite3Database<typeof schema>;

function createDb(file: string): { db: Db; sqlite: Database.Database } {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return { db: drizzle(sqlite, { schema }), sqlite };
}

// Global-cached so Next dev hot reload doesn't pile up open handles.
const globalForDb = globalThis as unknown as {
  __financeDb?: { db: Db; sqlite: Database.Database; file: string };
};

export function getDb(): Db {
  const file = resolveDbPath();
  if (!globalForDb.__financeDb || globalForDb.__financeDb.file !== file) {
    globalForDb.__financeDb = { ...createDb(file), file };
  }
  return globalForDb.__financeDb.db;
}

// For tests: an isolated connection against a throwaway file, bypassing the
// global cache.
export function createTestDb(file: string): { db: Db; sqlite: Database.Database } {
  return createDb(file);
}
