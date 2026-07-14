import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { ensureDefaultCategories } from "./default-categories";
import {
  preflightDatabaseOpen,
  preflightExplicitDatabaseOpen,
  type DatabaseOpenPreflight,
} from "./preflight";

// Compatibility adapter for callers that only need the selected path. It still
// performs the complete fail-closed preflight and never opens SQLite.
export function resolveDbPath(): string {
  return preflightDatabaseOpen().databasePath;
}

export type Db = BetterSQLite3Database<typeof schema>;

function createDb(
  preflight: Readonly<DatabaseOpenPreflight>,
  opts: { installDefaults?: boolean } = {},
): { db: Db; sqlite: Database.Database } {
  const file = preflight.databasePath;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(file);
    sqlite.pragma("journal_mode = WAL");
    // NORMAL is the documented WAL pairing: one fewer fsync per commit (i.e. per
    // server action), still corruption-safe — only the last commit is at risk on
    // power loss, acceptable beside db:backup (P6).
    sqlite.pragma("synchronous = NORMAL");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    // Idempotent per the reviewed journal — a fresh clone works without a
    // manual `npm run db:migrate`.
    migrate(db, { migrationsFolder: preflight.migrationsFolder });
    if (opts.installDefaults) ensureDefaultCategories(db);
    return { db, sqlite };
  } catch (error) {
    if (sqlite !== undefined) {
      try {
        sqlite.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          "Database initialization failed and the SQLite handle could not be closed.",
        );
      }
    }
    throw error;
  }
}

// Global-cached so Next dev hot reload doesn't pile up open handles.
const globalForDb = globalThis as unknown as {
  __financeDb?: { db: Db; sqlite: Database.Database; file: string };
};

export function getDb(): Db {
  const preflight = preflightDatabaseOpen();
  if (
    !globalForDb.__financeDb ||
    globalForDb.__financeDb.file !== preflight.databasePath
  ) {
    globalForDb.__financeDb = {
      ...createDb(preflight, { installDefaults: true }),
      file: preflight.databasePath,
    };
  }
  return globalForDb.__financeDb.db;
}

// For tests: an isolated, migrated connection against a throwaway file,
// bypassing the global cache. No default categories — tests control their
// own category fixtures.
export function createTestDb(file: string): { db: Db; sqlite: Database.Database } {
  return createDb(preflightExplicitDatabaseOpen(file));
}
