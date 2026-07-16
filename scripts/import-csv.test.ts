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
import { createTestDb } from "../src/db/client";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const IMPORT_SCRIPT = path.join(PROJECT_ROOT, "scripts", "import-csv.ts");
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
  csvPath: string;
  databasePath: string;
}

const temporaryRoots: string[] = [];

function createFixture(csvText: string, csvFilename = "synthetic.csv"): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "moneybags-import-cli-"));
  temporaryRoots.push(root);
  const repositoryRoot = path.join(root, "synthetic-repository");
  const cwd = path.join(root, "unrelated-cwd");
  const csvPath = path.join(root, csvFilename);
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
  writeFileSync(csvPath, csvText);
  return { root, repositoryRoot, cwd, csvPath, databasePath };
}

function runImport(
  fixture: Fixture,
  arguments_: string[],
  databaseTarget?: string,
) {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    NODE_ENV: "test",
    MONEYBAGS_REPOSITORY_ROOT: fixture.repositoryRoot,
  };
  if (databaseTarget !== undefined) environment.DB_FILE_NAME = databaseTarget;
  return spawnSync(process.execPath, [TSX_EXECUTABLE, IMPORT_SCRIPT, ...arguments_], {
    cwd: fixture.cwd,
    env: environment,
    encoding: "utf8",
    timeout: 15_000,
  });
}

function baseArguments(fixture: Fixture): string[] {
  return ["--file", fixture.csvPath, "--account", "Synthetic CLI Account"];
}

function logicalCounts(databasePath: string) {
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return {
      accounts: sqlite.prepare("SELECT count(*) FROM accounts").pluck().get(),
      categories: sqlite.prepare("SELECT count(*) FROM categories").pluck().get(),
      batches: sqlite.prepare("SELECT count(*) FROM import_batches").pluck().get(),
      transactions: sqlite.prepare("SELECT count(*) FROM transactions").pluck().get(),
      splits: sqlite.prepare("SELECT count(*) FROM transaction_splits").pluck().get(),
    };
  } finally {
    sqlite.close();
  }
}

function importedFilenames(databasePath: string): Array<string | null> {
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return sqlite
      .prepare("SELECT filename FROM import_batches ORDER BY created_at, id")
      .pluck()
      .all() as Array<string | null>;
  } finally {
    sqlite.close();
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("statement import CLI", () => {
  it.each([
    [
      "ambiguous dates",
      "Date,Description,Amount\n03/04/2026,SYNTHETIC,-1.00\n",
      [] as string[],
      /ambiguous dates require --date-format MDY or --date-format DMY/,
    ],
    [
      "an invalid row",
      "Date,Description,Amount\n2026-06-01,VALID,-1.00\n2026-06-02,BAD,garbage\n",
      [] as string[],
      /CSV contains invalid rows or structure/,
    ],
    [
      "an explicitly empty column override",
      "Date,Description,Amount\n2026-06-01,VALID,-1.00\n",
      ["--col-date", ""],
      /invalid column mapping/,
    ],
  ])("refuses %s before creating the default database", (_label, csv, extra, message) => {
    const fixture = createFixture(csv);
    const defaultDatabase = path.join(fixture.repositoryRoot, "data", "finance.db");

    const result = runImport(fixture, [...baseArguments(fixture), ...extra]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(message);
    expect(existsSync(defaultDatabase)).toBe(false);
  });

  it("creates once, reuses a compatible account, and refuses incompatible targets", () => {
    const fixture = createFixture(
      "Date,Description,Amount\n03/04/2026,SYNTHETIC PURCHASE,-1.00\n",
    );
    createTestDb(fixture.databasePath).sqlite.close();
    const validArguments = [
      ...baseArguments(fixture),
      "--date-format",
      "MDY",
      "--currency",
      "usd",
    ];

    const first = runImport(fixture, validArguments, fixture.databasePath);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.stdout).toMatch(/Created account .*CHECKING, USD/);
    expect(first.stdout).toMatch(/Imported: 1/);
    expect(logicalCounts(fixture.databasePath)).toEqual({
      accounts: 1,
      categories: 12,
      batches: 1,
      transactions: 1,
      splits: 0,
    });

    const second = runImport(fixture, validArguments, fixture.databasePath);
    expect(second.status).toBe(0);
    expect(second.stdout).not.toMatch(/Created account/);
    expect(second.stdout).toMatch(/Imported: 0/);
    const beforeConflict = logicalCounts(fixture.databasePath);

    for (const mismatch of [
      ["--type", "SAVINGS"],
      ["--currency", "EUR"],
    ]) {
      const result = runImport(
        fixture,
        [...baseArguments(fixture), "--date-format", "MDY", ...mismatch],
        fixture.databasePath,
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/does not match the import target/);
      expect(logicalCounts(fixture.databasePath)).toEqual(beforeConflict);
    }
  });

  it("rolls back defaults and a new account when transaction insertion fails", () => {
    const fixture = createFixture(
      "Date,Description,Amount\n2026-06-01,SYNTHETIC FAILURE,-1.00\n",
    );
    createTestDb(fixture.databasePath).sqlite.close();
    const sqlite = new Database(fixture.databasePath, { fileMustExist: true });
    try {
      sqlite.exec(`
        CREATE TRIGGER synthetic_cli_import_failure
        BEFORE INSERT ON transactions
        BEGIN
          SELECT RAISE(ABORT, 'synthetic cli import failure');
        END
      `);
    } finally {
      sqlite.close();
    }

    const result = runImport(fixture, baseArguments(fixture), fixture.databasePath);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Import failed unexpectedly.\n");
    expect(logicalCounts(fixture.databasePath)).toEqual({
      accounts: 0,
      categories: 0,
      batches: 0,
      transactions: 0,
      splits: 0,
    });
  });

  it("uses the shared service policy to store an NFC basename", () => {
    const fixture = createFixture(
      "Date,Description,Amount\n2026-06-01,SYNTHETIC,-1.00\n",
      "cafe\u0301.csv",
    );
    createTestDb(fixture.databasePath).sqlite.close();

    const result = runImport(fixture, baseArguments(fixture), fixture.databasePath);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(importedFilenames(fixture.databasePath)).toEqual(["café.csv"]);
  });
});
