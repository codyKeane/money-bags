import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import { REVIEWED_MIGRATIONS } from "./migration-manifest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const SEED_SCRIPT = path.join(PROJECT_ROOT, "src", "db", "seed.ts");
const require = createRequire(import.meta.url);
const tsxPackagePath = require.resolve("tsx/package.json");
const tsxMetadata = JSON.parse(readFileSync(tsxPackagePath, "utf8")) as {
  bin: string | Record<string, string>;
};
const tsxBin =
  typeof tsxMetadata.bin === "string" ? tsxMetadata.bin : tsxMetadata.bin.tsx;
if (!tsxBin) throw new Error("Synthetic CLI tests could not resolve the installed tsx binary.");
const TSX_EXECUTABLE = path.resolve(path.dirname(tsxPackagePath), tsxBin);

interface Fixture {
  root: string;
  repositoryRoot: string;
  cwd: string;
  databasePath: string;
}

const temporaryRoots: string[] = [];

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "moneybags-seed-cli-"));
  temporaryRoots.push(root);
  const repositoryRoot = path.join(root, "synthetic-repository");
  const cwd = path.join(root, "unrelated-cwd");
  const databasePath = path.join(root, "synthetic-ledger.sqlite");
  mkdirSync(repositoryRoot);
  mkdirSync(cwd);
  writeFileSync(
    path.join(repositoryRoot, "package.json"),
    `${JSON.stringify({ moneybagsRepositoryRoot: true })}\n`,
  );
  cpSync(path.join(PROJECT_ROOT, "drizzle"), path.join(repositoryRoot, "drizzle"), {
    recursive: true,
  });
  return { root, repositoryRoot, cwd, databasePath };
}

function runSeed(
  fixture: Fixture,
  options: { databaseTarget?: string; arguments?: string[] } = {},
) {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    NODE_ENV: "test",
    MONEYBAGS_REPOSITORY_ROOT: fixture.repositoryRoot,
  };
  if (options.databaseTarget !== undefined) {
    environment.DB_FILE_NAME = options.databaseTarget;
  }
  return spawnSync(
    process.execPath,
    [TSX_EXECUTABLE, SEED_SCRIPT, ...(options.arguments ?? [])],
    {
      cwd: fixture.cwd,
      env: environment,
      encoding: "utf8",
      timeout: 15_000,
    },
  );
}

function currentTarget(databasePath: string): void {
  createTestDb(databasePath).sqlite.close();
}

function logicalCounts(databasePath: string) {
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return {
      accounts: sqlite.prepare("SELECT count(*) FROM accounts").pluck().get(),
      categories: sqlite.prepare("SELECT count(*) FROM categories").pluck().get(),
      transactions: sqlite.prepare("SELECT count(*) FROM transactions").pluck().get(),
      batches: sqlite.prepare("SELECT count(*) FROM import_batches").pluck().get(),
      splits: sqlite.prepare("SELECT count(*) FROM transaction_splits").pluck().get(),
    };
  } finally {
    sqlite.close();
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("demo seed CLI", () => {
  it("seeds an explicit current temp target from an unrelated working directory", () => {
    const fixture = createFixture();
    currentTarget(fixture.databasePath);

    const result = runSeed(fixture, { databaseTarget: fixture.databasePath });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      `Demo seed target: ${fixture.databasePath}\n` +
        "Demo seed complete: 2 accounts, 12 categories, 132 transactions.\n",
    );
    expect(result.stdout).not.toMatch(/ACME|PAYROLL|amount|opening balance/i);
    expect(logicalCounts(fixture.databasePath)).toEqual({
      accounts: 2,
      categories: 12,
      transactions: 132,
      batches: 0,
      splits: 0,
    });
  });

  it("returns nonzero on a second run and leaves the first result unchanged", () => {
    const fixture = createFixture();
    currentTarget(fixture.databasePath);
    expect(runSeed(fixture, { databaseTarget: fixture.databasePath }).status).toBe(0);
    const before = logicalCounts(fixture.databasePath);

    const result = runSeed(fixture, { databaseTarget: fixture.databasePath });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`Demo seed target: ${fixture.databasePath}\n`);
    expect(result.stderr).toMatch(/Demo seed refused:.*disposable database/);
    expect(logicalCounts(fixture.databasePath)).toEqual(before);
  });

  it("refuses a missing target without creating or migrating it", () => {
    const fixture = createFixture();

    const result = runSeed(fixture, { databaseTarget: fixture.databasePath });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`Demo seed target: ${fixture.databasePath}\n`);
    expect(result.stderr).toMatch(/does not exist.*db:migrate/);
    expect(existsSync(fixture.databasePath)).toBe(false);
  });

  it("refuses historical migration history without changing the target", () => {
    const fixture = createFixture();
    currentTarget(fixture.databasePath);
    const sqlite = new Database(fixture.databasePath, { fileMustExist: true });
    try {
      sqlite
        .prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?")
        .run(REVIEWED_MIGRATIONS.at(-1)?.when);
    } finally {
      sqlite.close();
    }
    const before = logicalCounts(fixture.databasePath);

    const result = runSeed(fixture, { databaseTarget: fixture.databasePath });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not at the current reviewed schema.*db:migrate/);
    expect(logicalCounts(fixture.databasePath)).toEqual(before);
  });

  it("fails on a non-file .env before creating the default database", () => {
    const fixture = createFixture();
    mkdirSync(path.join(fixture.repositoryRoot, ".env"));
    const defaultDatabase = path.join(fixture.repositoryRoot, "data", "finance.db");

    const result = runSeed(fixture);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/Demo seed preflight.*Verify \.env/);
    expect(existsSync(defaultDatabase)).toBe(false);
  });

  it("rejects unsafe relative targets and never creates their destinations", () => {
    const fixture = createFixture();
    const escape = path.join(fixture.root, "escape.sqlite");

    const result = runSeed(fixture, { databaseTarget: "../escape.sqlite" });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/Demo seed preflight/);
    expect(existsSync(escape)).toBe(false);
  });

  it("rejects every argument, including a force-like flag, before opening the target", () => {
    const fixture = createFixture();
    currentTarget(fixture.databasePath);
    const before = logicalCounts(fixture.databasePath);

    const result = runSeed(fixture, {
      databaseTarget: fixture.databasePath,
      arguments: ["--force"],
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/accepts no arguments or force flag/);
    expect(logicalCounts(fixture.databasePath)).toEqual(before);
  });
});
