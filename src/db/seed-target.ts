import Database from "better-sqlite3";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { REVIEWED_MIGRATIONS } from "./migration-manifest";
import { enforcePrivateProcessUmask } from "./private-process";

export type DemoSeedRefusalReason =
  | "missing-target"
  | "schema-not-current"
  | "ineligible-target";

export class DemoSeedRefusal extends Error {
  readonly code = "ERR_MONEYBAGS_DEMO_SEED_REFUSED";

  constructor(
    readonly reason: DemoSeedRefusalReason,
    message: string,
  ) {
    super(message);
    this.name = "DemoSeedRefusal";
  }
}

export interface AppliedMigrationRow {
  hash: string;
  createdAt: number;
}

export const CURRENT_SCHEMA_REQUIRED_MESSAGE =
  "Demo seed refused: the target is not at the current reviewed schema. Run npm run db:migrate against the intended disposable demo target first.";

export function assertCurrentMigrationHistory(
  rows: readonly AppliedMigrationRow[],
): void {
  if (rows.length !== REVIEWED_MIGRATIONS.length) {
    throw new DemoSeedRefusal("schema-not-current", CURRENT_SCHEMA_REQUIRED_MESSAGE);
  }
  for (const [index, expected] of REVIEWED_MIGRATIONS.entries()) {
    const actual = rows[index];
    if (actual?.hash !== expected.sha256 || actual.createdAt !== expected.when) {
      throw new DemoSeedRefusal("schema-not-current", CURRENT_SCHEMA_REQUIRED_MESSAGE);
    }
  }
}

function readAppliedMigrations(sqlite: Database.Database): AppliedMigrationRow[] {
  try {
    return sqlite
      .prepare<[], AppliedMigrationRow>(
        `SELECT hash, created_at AS createdAt
         FROM __drizzle_migrations
         ORDER BY created_at`,
      )
      .all();
  } catch {
    throw new DemoSeedRefusal("schema-not-current", CURRENT_SCHEMA_REQUIRED_MESSAGE);
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

interface FileIdentity {
  device: bigint;
  inode: bigint;
}

function inspectExistingTarget(databasePath: string): FileIdentity {
  const stats = lstatSync(databasePath, { bigint: true });
  if (!stats.isFile() || stats.isSymbolicLink() || realpathSync(databasePath) !== databasePath) {
    throw new DemoSeedRefusal(
      "missing-target",
      "Demo seed refused: the target must be an existing canonical database file.",
    );
  }
  return { device: stats.dev, inode: stats.ino };
}

function assertSameTarget(databasePath: string, expected: FileIdentity): void {
  const actual = inspectExistingTarget(databasePath);
  if (actual.device !== expected.device || actual.inode !== expected.inode) {
    throw new DemoSeedRefusal(
      "missing-target",
      "Demo seed refused: the target changed while it was being inspected.",
    );
  }
}

// Opens only an existing, canonical, current database. The read-only schema
// check happens before a read-write handle exists, and fileMustExist closes the
// remaining removal race without ever creating or migrating a target.
export function openExistingDemoSeedTarget(databasePath: string): Database.Database {
  if (!path.isAbsolute(databasePath) || path.resolve(databasePath) !== databasePath) {
    throw new DemoSeedRefusal(
      "missing-target",
      "Demo seed refused: the target path must be absolute and canonical.",
    );
  }

  let identity: FileIdentity;
  try {
    identity = inspectExistingTarget(databasePath);
  } catch (error) {
    if (error instanceof DemoSeedRefusal) throw error;
    if (isNodeError(error, "ENOENT")) {
      throw new DemoSeedRefusal(
        "missing-target",
        "Demo seed refused: the target database does not exist. Run npm run db:migrate against the intended disposable demo target first.",
      );
    }
    throw new DemoSeedRefusal(
      "missing-target",
      "Demo seed refused: the existing target could not be inspected safely.",
    );
  }

  let readonly: Database.Database | undefined;
  try {
    enforcePrivateProcessUmask();
    readonly = new Database(databasePath, { readonly: true, fileMustExist: true });
    assertSameTarget(databasePath, identity);
    assertCurrentMigrationHistory(readAppliedMigrations(readonly));
  } catch (error) {
    if (error instanceof DemoSeedRefusal) throw error;
    throw new DemoSeedRefusal("schema-not-current", CURRENT_SCHEMA_REQUIRED_MESSAGE);
  } finally {
    readonly?.close();
  }

  try {
    const sqlite = new Database(databasePath, { fileMustExist: true });
    try {
      assertSameTarget(databasePath, identity);
      sqlite.pragma("foreign_keys = ON");
      return sqlite;
    } catch (error) {
      sqlite.close();
      throw error;
    }
  } catch {
    throw new DemoSeedRefusal(
      "missing-target",
      "Demo seed refused: the existing target could not be opened for an atomic demo initialization.",
    );
  }
}
