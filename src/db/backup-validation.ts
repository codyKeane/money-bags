import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { REVIEWED_MIGRATIONS } from "./migration-manifest";

interface AppliedMigrationRow {
  readonly hash: string;
  readonly createdAt: number;
}

interface SchemaRow {
  readonly type: string;
  readonly name: string;
  readonly tableName: string;
  readonly sql: string | null;
}

export interface BackupSchemaRevision {
  readonly kind: "current" | "historical";
  readonly index: number;
  readonly tag: string;
}

export class BackupLogicalValidationError extends Error {
  readonly code = "ERR_MONEYBAGS_BACKUP_LOGICALLY_INVALID";

  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "BackupLogicalValidationError";
  }
}

export class BackupOperationalValidationError extends Error {
  readonly code = "ERR_MONEYBAGS_BACKUP_VALIDATION_INDETERMINATE";

  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "BackupOperationalValidationError";
  }
}

export interface BackupValidationOracle {
  readonly currentRevision: BackupSchemaRevision;
  validate(sqlite: Database.Database): BackupSchemaRevision;
}

function readSchema(sqlite: Database.Database): readonly SchemaRow[] {
  return sqlite
    .prepare<[], SchemaRow>(
      `SELECT type, name, tbl_name AS tableName, sql
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    )
    .all();
}

function sameSchema(
  actual: readonly SchemaRow[],
  expected: readonly SchemaRow[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((row, index) => {
      const expectedRow = expected[index];
      return (
        expectedRow !== undefined &&
        row.type === expectedRow.type &&
        row.name === expectedRow.name &&
        row.tableName === expectedRow.tableName &&
        row.sql === expectedRow.sql
      );
    })
  );
}

function validationError(error: unknown): Error {
  if (
    error instanceof BackupLogicalValidationError ||
    error instanceof BackupOperationalValidationError
  ) {
    return error;
  }

  const sqliteCode =
    error instanceof Error && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  if (
    /^(SQLITE_(BUSY|LOCKED|CANTOPEN|PERM|FULL)|SQLITE_IOERR(?:_|$))/.test(
      sqliteCode,
    )
  ) {
    return new BackupOperationalValidationError(
      "Backup validation could not complete because SQLite storage was unavailable.",
      { cause: error },
    );
  }
  return new BackupLogicalValidationError(
    "Backup content is not a supported Moneybags database image.",
    { cause: error },
  );
}

function requireSupportedHistory(
  sqlite: Database.Database,
): { readonly count: number; readonly revision: BackupSchemaRevision } {
  const rows = sqlite
    .prepare<[], AppliedMigrationRow>(
      `SELECT hash, created_at AS createdAt
       FROM __drizzle_migrations
       ORDER BY created_at`,
    )
    .all();

  if (rows.length < 1 || rows.length > REVIEWED_MIGRATIONS.length) {
    throw new BackupLogicalValidationError(
      "Backup migration history is empty, newer, or unsupported.",
    );
  }
  for (const [index, row] of rows.entries()) {
    const expected = REVIEWED_MIGRATIONS[index];
    if (
      expected === undefined ||
      row.hash !== expected.sha256 ||
      row.createdAt !== expected.when
    ) {
      throw new BackupLogicalValidationError(
        "Backup migration history diverges from the reviewed sequence.",
      );
    }
  }

  const index = rows.length - 1;
  const migration = REVIEWED_MIGRATIONS[index];
  if (migration === undefined) {
    throw new BackupLogicalValidationError(
      "Backup migration revision is unsupported.",
    );
  }
  return {
    count: rows.length,
    revision: Object.freeze({
      kind: rows.length === REVIEWED_MIGRATIONS.length ? "current" : "historical",
      index,
      tag: migration.tag,
    }),
  };
}

/**
 * Builds immutable schema fingerprints from the strict, hash-pinned migration
 * assets. This writes only to an in-memory SQLite database.
 */
export function createBackupValidationOracle(
  migrationsFolder: string,
): BackupValidationOracle {
  const migrations = readMigrationFiles({ migrationsFolder });
  if (migrations.length !== REVIEWED_MIGRATIONS.length) {
    throw new Error("Reviewed backup-validation migrations are unavailable.");
  }
  for (const [index, migration] of migrations.entries()) {
    const reviewed = REVIEWED_MIGRATIONS[index];
    if (
      reviewed === undefined ||
      migration.hash !== reviewed.sha256 ||
      migration.folderMillis !== reviewed.when
    ) {
      throw new Error("Backup-validation migrations do not match the reviewed manifest.");
    }
  }

  const expectedSchemas = new Map<number, readonly SchemaRow[]>();
  const reference = new Database(":memory:");
  try {
    // Match Drizzle's SQLite dialect exactly so sqlite_schema is a useful
    // fingerprint instead of merely a list of table/index names.
    reference.exec(
      'CREATE TABLE "__drizzle_migrations" (\n' +
        "\t\t\t\tid SERIAL PRIMARY KEY,\n" +
        "\t\t\t\thash text NOT NULL,\n" +
        "\t\t\t\tcreated_at numeric\n" +
        "\t\t\t)",
    );
    const recordMigration = reference.prepare(
      `INSERT INTO __drizzle_migrations (hash, created_at)
       VALUES (?, ?)`,
    );
    for (const [index, migration] of migrations.entries()) {
      reference.exec("BEGIN");
      try {
        for (const statement of migration.sql) reference.exec(statement);
        recordMigration.run(migration.hash, migration.folderMillis);
        reference.exec("COMMIT");
      } catch (error) {
        if (reference.inTransaction) reference.exec("ROLLBACK");
        throw error;
      }
      expectedSchemas.set(index + 1, Object.freeze(readSchema(reference)));
    }
  } finally {
    reference.close();
  }

  const currentMigration = REVIEWED_MIGRATIONS.at(-1);
  if (currentMigration === undefined) {
    throw new Error("At least one reviewed migration is required.");
  }
  const currentRevision: BackupSchemaRevision = Object.freeze({
    kind: "current",
    index: REVIEWED_MIGRATIONS.length - 1,
    tag: currentMigration.tag,
  });

  return Object.freeze({
    currentRevision,
    validate(sqlite: Database.Database): BackupSchemaRevision {
      try {
        sqlite.pragma("query_only = ON");
        const quickCheck = sqlite.pragma("quick_check(1)") as Array<{
          quick_check?: unknown;
        }>;
        if (
          quickCheck.length !== 1 ||
          quickCheck[0]?.quick_check !== "ok"
        ) {
          throw new BackupLogicalValidationError(
            "Backup failed SQLite quick_check.",
          );
        }
        const foreignKeyFailure = sqlite
          .prepare("SELECT 1 FROM pragma_foreign_key_check LIMIT 1")
          .get();
        if (foreignKeyFailure !== undefined) {
          throw new BackupLogicalValidationError(
            "Backup failed SQLite foreign_key_check.",
          );
        }

        const { count, revision } = requireSupportedHistory(sqlite);
        const expectedSchema = expectedSchemas.get(count);
        if (
          expectedSchema === undefined ||
          !sameSchema(readSchema(sqlite), expectedSchema)
        ) {
          throw new BackupLogicalValidationError(
            "Backup schema does not match its reviewed migration revision.",
          );
        }
        return revision;
      } catch (error) {
        throw validationError(error);
      }
    },
  });
}
