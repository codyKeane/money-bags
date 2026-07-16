import Database from "better-sqlite3";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import { REVIEWED_MIGRATIONS } from "./migration-manifest";
import {
  assertCurrentMigrationHistory,
  DemoSeedRefusal,
  openExistingDemoSeedTarget,
} from "./seed-target";

describe("demo seed target safety", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "moneybags-seed-target-"));
    databasePath = path.join(directory, "synthetic.sqlite");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function createCurrentTarget(): void {
    createTestDb(databasePath).sqlite.close();
  }

  it("opens an existing target with the exact reviewed migration history", () => {
    createCurrentTarget();
    const sqlite = openExistingDemoSeedTarget(databasePath);
    try {
      expect(sqlite.open).toBe(true);
      expect(sqlite.name).toBe(databasePath);
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("refuses a missing target without creating it", () => {
    expect(() => openExistingDemoSeedTarget(databasePath)).toThrowError(DemoSeedRefusal);
    expect(() => new Database(databasePath, { readonly: true, fileMustExist: true })).toThrow();
  });

  it("refuses a target whose applied history is older than the reviewed manifest", () => {
    createCurrentTarget();
    const sqlite = new Database(databasePath, { fileMustExist: true });
    try {
      sqlite
        .prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?")
        .run(REVIEWED_MIGRATIONS.at(-1)?.when);
    } finally {
      sqlite.close();
    }

    expect(() => openExistingDemoSeedTarget(databasePath)).toThrowError(
      expect.objectContaining({ reason: "schema-not-current" }),
    );
  });

  it("refuses an unknown applied migration hash", () => {
    createCurrentTarget();
    const sqlite = new Database(databasePath, { fileMustExist: true });
    try {
      sqlite
        .prepare("UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?")
        .run("synthetic-unknown-hash", REVIEWED_MIGRATIONS[0]?.when);
    } finally {
      sqlite.close();
    }

    expect(() => openExistingDemoSeedTarget(databasePath)).toThrowError(
      expect.objectContaining({ reason: "schema-not-current" }),
    );
  });

  it("refuses an existing file without migration history and leaves it unchanged", () => {
    const sqlite = new Database(databasePath);
    sqlite.exec("CREATE TABLE synthetic_sentinel (value TEXT NOT NULL)");
    sqlite.prepare("INSERT INTO synthetic_sentinel (value) VALUES (?)").run("unchanged");
    sqlite.close();

    expect(() => openExistingDemoSeedTarget(databasePath)).toThrowError(
      expect.objectContaining({ reason: "schema-not-current" }),
    );

    const verification = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      expect(
        verification.prepare("SELECT value FROM synthetic_sentinel").pluck().all(),
      ).toEqual(["unchanged"]);
    } finally {
      verification.close();
    }
  });

  it("refuses symlink targets even when they point to a current database", () => {
    createCurrentTarget();
    const link = path.join(directory, "synthetic-link.sqlite");
    symlinkSync(databasePath, link);

    expect(() => openExistingDemoSeedTarget(link)).toThrowError(
      expect.objectContaining({ reason: "missing-target" }),
    );
  });

  it("compares applied rows in reviewed order and rejects missing or extra rows", () => {
    const exact = REVIEWED_MIGRATIONS.map((migration) => ({
      hash: migration.sha256,
      createdAt: migration.when,
    }));
    expect(() => assertCurrentMigrationHistory(exact)).not.toThrow();
    expect(() => assertCurrentMigrationHistory(exact.slice(1))).toThrowError(
      DemoSeedRefusal,
    );
    expect(() =>
      assertCurrentMigrationHistory([
        ...exact,
        { hash: "synthetic-extra", createdAt: Number.MAX_SAFE_INTEGER },
      ]),
    ).toThrowError(DemoSeedRefusal);
  });
});
