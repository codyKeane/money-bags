import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import {
  BackupLogicalValidationError,
  createBackupValidationOracle,
} from "./backup-validation";
import {
  BackupVerificationInputError,
  validateBackupImageFile,
  verifyStandaloneBackup,
} from "./backup-verifier";
import { REVIEWED_MIGRATIONS } from "./migration-manifest";
import { findRepositoryRoot } from "./path";

const REPOSITORY_ROOT = findRepositoryRoot({ moduleDirectory: __dirname });
const MIGRATIONS_FOLDER = path.join(REPOSITORY_ROOT, "drizzle");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTemp(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "moneybags-backup-validation-"));
  temporaryDirectories.push(directory);
  return directory;
}

function historicalMigrations(root: string, lastIndex: number): string {
  const folder = path.join(root, `migrations-${lastIndex}`);
  mkdirSync(path.join(folder, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
  ) as { entries: unknown[] };
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    `${JSON.stringify({ ...journal, entries: journal.entries.slice(0, lastIndex + 1) })}\n`,
  );
  for (const migration of REVIEWED_MIGRATIONS.slice(0, lastIndex + 1)) {
    copyFileSync(
      path.join(MIGRATIONS_FOLDER, `${migration.tag}.sql`),
      path.join(folder, `${migration.tag}.sql`),
    );
  }
  return folder;
}

function createMigratedImage(
  root: string,
  name: string,
  lastIndex = REVIEWED_MIGRATIONS.length - 1,
): string {
  const file = path.join(root, name);
  const sqlite = new Database(file);
  try {
    sqlite.pragma("foreign_keys = ON");
    const folder =
      lastIndex === REVIEWED_MIGRATIONS.length - 1
        ? MIGRATIONS_FOLDER
        : historicalMigrations(root, lastIndex);
    migrate(drizzle(sqlite), { migrationsFolder: folder });
    sqlite
      .prepare(
        `INSERT INTO accounts
          (id, name, type, currency, opening_balance_cents, created_at, updated_at)
         VALUES ('synthetic-account', 'Synthetic Account', 'CASH', 'USD', 0, 1, 1)`,
      )
      .run();
  } finally {
    sqlite.close();
  }
  return file;
}

function digest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("backup validation oracle", () => {
  it.each(REVIEWED_MIGRATIONS.map((migration, index) => ({ migration, index })))(
    "accepts the populated reviewed prefix $migration.tag",
    ({ migration, index }) => {
      const root = makeTemp();
      const file = createMigratedImage(root, `historical-${index}.sqlite3`, index);
      const result = validateBackupImageFile(
        file,
        createBackupValidationOracle(MIGRATIONS_FOLDER),
      );

      expect(result.revision).toEqual({
        kind: index === REVIEWED_MIGRATIONS.length - 1 ? "current" : "historical",
        index,
        tag: migration.tag,
      });
    },
  );

  it("rejects a forged reviewed journal when the schema is unrelated", () => {
    const root = makeTemp();
    const file = path.join(root, "forged.sqlite3");
    const sqlite = new Database(file);
    const first = REVIEWED_MIGRATIONS[0];
    try {
      sqlite.exec(`
        CREATE TABLE __drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at numeric
        );
        CREATE TABLE unrelated (secret text);
      `);
      sqlite
        .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
        .run(first?.sha256, first?.when);
    } finally {
      sqlite.close();
    }

    expect(() =>
      validateBackupImageFile(file, createBackupValidationOracle(MIGRATIONS_FOLDER)),
    ).toThrow(BackupLogicalValidationError);
  });

  it("rejects divergent, newer, foreign-key-invalid, and empty histories", () => {
    const oracle = createBackupValidationOracle(MIGRATIONS_FOLDER);
    const cases: string[] = [];

    const divergentRoot = makeTemp();
    const divergent = createMigratedImage(divergentRoot, "divergent.sqlite3");
    const divergentDb = new Database(divergent);
    divergentDb
      .prepare(
        `UPDATE __drizzle_migrations
         SET hash = 'unknown'
         WHERE rowid = (SELECT min(rowid) FROM __drizzle_migrations)`,
      )
      .run();
    divergentDb.close();
    cases.push(divergent);

    const newerRoot = makeTemp();
    const newer = createMigratedImage(newerRoot, "newer.sqlite3");
    const newerDb = new Database(newer);
    newerDb
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('newer', ?)")
      .run((REVIEWED_MIGRATIONS.at(-1)?.when ?? 0) + 1);
    newerDb.close();
    cases.push(newer);

    const foreignKeyRoot = makeTemp();
    const foreignKey = createMigratedImage(foreignKeyRoot, "foreign-key.sqlite3");
    const foreignKeyDb = new Database(foreignKey);
    foreignKeyDb.pragma("foreign_keys = OFF");
    foreignKeyDb
      .prepare(
        `INSERT INTO transactions
          (id, date, description, amount_cents, account_id, created_at, updated_at)
         VALUES ('bad-fk', '2026-01-01', 'synthetic', 1, 'missing', 1, 1)`,
      )
      .run();
    foreignKeyDb.close();
    cases.push(foreignKey);

    const emptyRoot = makeTemp();
    const empty = path.join(emptyRoot, "empty.sqlite3");
    const emptyDb = new Database(empty);
    emptyDb.exec(`CREATE TABLE __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`);
    emptyDb.close();
    cases.push(empty);

    for (const file of cases) {
      expect(() => validateBackupImageFile(file, oracle), file).toThrow(
        BackupLogicalValidationError,
      );
    }
  });
});

describe("standalone backup verifier", () => {
  it("is read-only and reports only the supported current revision", () => {
    const root = makeTemp();
    const candidate = createMigratedImage(root, "offline-copy.sqlite3");
    const live = createMigratedImage(root, "live.sqlite3");
    const before = {
      digest: digest(candidate),
      mode: statSync(candidate).mode,
      mtimeMs: statSync(candidate).mtimeMs,
      entries: readdirSync(root).sort(),
    };

    const result = verifyStandaloneBackup({
      candidatePath: candidate,
      liveDatabasePath: live,
      oracle: createBackupValidationOracle(MIGRATIONS_FOLDER),
    });

    expect(result.revision).toEqual({
      kind: "current",
      index: REVIEWED_MIGRATIONS.length - 1,
      tag: REVIEWED_MIGRATIONS.at(-1)?.tag,
    });
    expect({
      digest: digest(candidate),
      mode: statSync(candidate).mode,
      mtimeMs: statSync(candidate).mtimeMs,
      entries: readdirSync(root).sort(),
    }).toEqual(before);
  });

  it("rejects live targets, aliases, symlinks, sidecars, partials, and invalids", () => {
    const oracle = createBackupValidationOracle(MIGRATIONS_FOLDER);

    const liveRoot = makeTemp();
    const live = createMigratedImage(liveRoot, "live.sqlite3");
    expect(() =>
      verifyStandaloneBackup({
        candidatePath: live,
        liveDatabasePath: live,
        oracle,
      }),
    ).toThrow(BackupVerificationInputError);

    const alias = path.join(liveRoot, "alias.sqlite3");
    linkSync(live, alias);
    expect(() =>
      verifyStandaloneBackup({ candidatePath: alias, liveDatabasePath: live, oracle }),
    ).toThrow(BackupVerificationInputError);

    const candidateRoot = makeTemp();
    const candidate = createMigratedImage(candidateRoot, "candidate.sqlite3");
    const symlink = path.join(candidateRoot, "symlink.sqlite3");
    symlinkSync(candidate, symlink);
    expect(() =>
      verifyStandaloneBackup({ candidatePath: symlink, liveDatabasePath: live, oracle }),
    ).toThrow(BackupVerificationInputError);

    writeFileSync(`${candidate}-wal`, "synthetic-sidecar");
    expect(() =>
      verifyStandaloneBackup({ candidatePath: candidate, liveDatabasePath: live, oracle }),
    ).toThrow(BackupVerificationInputError);

    for (const suffix of ["partial", "invalid"]) {
      const unsafe = createMigratedImage(
        makeTemp(),
        `moneybags-synthetic.${suffix}`,
      );
      expect(() =>
        verifyStandaloneBackup({ candidatePath: unsafe, liveDatabasePath: live, oracle }),
      ).toThrow(BackupVerificationInputError);
    }
  });

  it("rejects a sidecar-free WAL-mode main file without creating sidecars", () => {
    const root = makeTemp();
    const live = createMigratedImage(root, "configured-live.sqlite3");
    const candidate = createMigratedImage(root, "wal-header.sqlite3");
    const sqlite = new Database(candidate, { fileMustExist: true });
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    sqlite.close();
    rmSync(`${candidate}-wal`, { force: true });
    rmSync(`${candidate}-shm`, { force: true });
    const before = readdirSync(root).sort();

    expect(() =>
      verifyStandaloneBackup({
        candidatePath: candidate,
        liveDatabasePath: live,
        oracle: createBackupValidationOracle(MIGRATIONS_FOLDER),
      }),
    ).toThrow(BackupLogicalValidationError);
    expect(readdirSync(root).sort()).toEqual(before);
    expect(existsSync(`${candidate}-wal`)).toBe(false);
    expect(existsSync(`${candidate}-shm`)).toBe(false);
  });
});
