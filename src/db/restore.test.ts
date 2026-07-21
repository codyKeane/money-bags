import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBackupValidationOracle } from "./backup-validation";
import { createValidatedBackup } from "./backup-publication";
import { restoreDatabase } from "./restore";
import { findRepositoryRoot } from "./path";

const repositoryRoot = findRepositoryRoot({ moduleDirectory: __dirname });
const migrationsFolder = path.join(repositoryRoot, "drizzle");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function ledger(root: string, accountId: string): { file: string; sqlite: Database.Database } {
  const runtime = path.join(root, "runtime");
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const file = path.join(runtime, "finance.db");
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = DELETE");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, type, currency, opening_balance_cents, created_at, updated_at)
       VALUES (?, ?, 'CHECKING', 'USD', 0, 1, 1)`,
    )
    .run(accountId, accountId);
  return { file, sqlite };
}

function preflight(file: string) {
  return Object.freeze({ repositoryRoot, databasePath: file, migrationsFolder });
}

describe("guarded restore", () => {
  it("previews without mutation, then restores only with confirmation and retains a validated rescue", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "moneybags-restore-"));
    temporaryRoots.push(root);
    const target = ledger(path.join(root, "target"), "target-account");
    const source = ledger(path.join(root, "source"), "source-account");
    const oracle = createBackupValidationOracle(migrationsFolder);
    target.sqlite.close();
    const backup = await createValidatedBackup({ preflight: preflight(source.file) });
    source.sqlite.close();
    const backupPath = path.join(backup.backupDirectory, backup.filename);

    const preview = await restoreDatabase({
      backupPath,
      targetPath: target.file,
      preflight: preflight(target.file),
      oracle,
      uuid: () => "10000000-0000-4000-8000-000000000001",
      now: () => new Date("2026-07-17T12:00:00.000Z"),
    });
    expect(preview.status).toBe("preview");
    expect(existsSync(preview.rescuePath)).toBe(false);
    const beforePreview = new Database(target.file, { readonly: true, fileMustExist: true });
    expect(beforePreview.prepare("SELECT id FROM accounts").get()).toEqual({ id: "target-account" });
    beforePreview.close();

    const restored = await restoreDatabase({
      backupPath,
      targetPath: target.file,
      preflight: preflight(target.file),
      confirm: true,
      quiesced: true,
      oracle,
      uuid: () => "20000000-0000-4000-8000-000000000002",
      now: () => new Date("2026-07-17T12:00:00.000Z"),
    });
    expect(restored.status).toBe("restored");
    expect(existsSync(restored.rescuePath)).toBe(true);
    const after = new Database(target.file, { readonly: true, fileMustExist: true });
    expect(after.prepare("SELECT id FROM accounts").get()).toEqual({ id: "source-account" });
    after.close();
    expect(existsSync(`${target.file}.restore.lock`)).toBe(false);
  });

  it("refuses confirmation without an explicit quiesced gate", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "moneybags-restore-gate-"));
    temporaryRoots.push(root);
    const target = ledger(path.join(root, "target"), "target-account");
    const source = ledger(path.join(root, "source"), "source-account");
    target.sqlite.close();
    const backup = await createValidatedBackup({ preflight: preflight(source.file) });
    source.sqlite.close();
    await expect(
      restoreDatabase({
        backupPath: path.join(backup.backupDirectory, backup.filename),
        targetPath: target.file,
        preflight: preflight(target.file),
        confirm: true,
        oracle: createBackupValidationOracle(migrationsFolder),
      }),
    ).rejects.toThrow(/quiesced/iu);
  });
});
