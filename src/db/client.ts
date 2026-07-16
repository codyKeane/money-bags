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
import { enforcePrivateProcessUmask } from "./private-process";

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
  enforcePrivateProcessUmask();
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
  __financeDb?: {
    db: Db;
    sqlite: Database.Database;
    file: string;
    defaultsInstalled: boolean;
  };
};

// Test infrastructure uses this to release the worker-owned implicit handle
// before deleting its temporary directory. Clear the cache first so a failed
// close can never leave a closed-or-unknown handle available for reuse.
export function closeImplicitDb(): void {
  const current = globalForDb.__financeDb;
  if (!current) return;
  delete globalForDb.__financeDb;
  current.sqlite.close();
}

export function getDb(
  options: { installDefaults?: boolean } = {},
): Db {
  const installDefaults = options.installDefaults ?? true;
  const preflight = preflightDatabaseOpen();
  if (globalForDb.__financeDb?.file !== preflight.databasePath) {
    closeImplicitDb();
    globalForDb.__financeDb = {
      ...createDb(preflight, { installDefaults }),
      file: preflight.databasePath,
      defaultsInstalled: installDefaults,
    };
  } else if (installDefaults && !globalForDb.__financeDb.defaultsInstalled) {
    ensureDefaultCategories(globalForDb.__financeDb.db);
    globalForDb.__financeDb.defaultsInstalled = true;
  }
  return globalForDb.__financeDb.db;
}

// For tests: an isolated, migrated connection against a throwaway file,
// bypassing the global cache. No default categories — tests control their
// own category fixtures.
export function createTestDb(file: string): { db: Db; sqlite: Database.Database } {
  return createDb(preflightExplicitDatabaseOpen(file));
}
