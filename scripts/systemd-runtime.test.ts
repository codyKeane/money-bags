import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { backupDirectoryForDatabase } from "../src/db/backup-location";
import { createBackupValidationOracle } from "../src/db/backup-validation";
import { validateBackupImageFile } from "../src/db/backup-verifier";
import { findRepositoryRoot } from "../src/db/path";

const SOURCE_ROOT = findRepositoryRoot({ moduleDirectory: __dirname });
const TSX_CLI = path.join(SOURCE_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SERVICE_PREFLIGHT = path.join(SOURCE_ROOT, "scripts", "service-preflight.ts");
const BACKUP_SCRIPT = path.join(SOURCE_ROOT, "scripts", "backup-db.ts");
const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "moneybags-systemd-runtime-"));
  roots.push(root);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ moneybagsRepositoryRoot: true, engines: { node: ">=20.12" } }),
  );
  cpSync(path.join(SOURCE_ROOT, "tsconfig.json"), path.join(root, "tsconfig.json"));
  cpSync(path.join(SOURCE_ROOT, "drizzle"), path.join(root, "drizzle"), {
    recursive: true,
  });
  mkdirSync(path.join(root, ".next"), { mode: 0o700 });
  mkdirSync(path.join(root, ".next", "cache"), { mode: 0o700 });
  writeFileSync(path.join(root, ".next", "BUILD_ID"), "synthetic-build");
  writeFileSync(
    path.join(root, ".next", "required-server-files.json"),
    JSON.stringify({
      version: 1,
      config: { distDir: ".next" },
      appDir: root,
      relativeAppDir: "",
      files: [".next/BUILD_ID", ".next/required-server-files.json"],
    }),
  );
  const runtime = path.join(root, "data");
  mkdirSync(runtime, { mode: 0o700 });
  const databasePath = path.join(runtime, "ledger.sqlite3");
  const environment: NodeJS.ProcessEnv = {
    HOME: root,
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "",
    NODE_ENV: "production",
    DB_FILE_NAME: databasePath,
    MONEYBAGS_REPOSITORY_ROOT: root,
    TSX_DISABLE_CACHE: "1",
  };
  return { root, runtime, databasePath, environment };
}

function runServicePreflight(current: ReturnType<typeof fixture>, mode: "app" | "backup") {
  const usesSetpriv = process.platform === "linux" && existsSync("/usr/bin/setpriv");
  const executable = usesSetpriv ? "/usr/bin/setpriv" : process.execPath;
  const args = usesSetpriv
    ? [
        "--no-new-privs",
        process.execPath,
        TSX_CLI,
        "--no-cache",
        SERVICE_PREFLIGHT,
        mode,
      ]
    : [TSX_CLI, "--no-cache", SERVICE_PREFLIGHT, mode];
  const previousUmask = process.umask(0o077);
  try {
    return spawnSync(executable, args, {
      cwd: current.root,
      encoding: "utf8",
      env: current.environment,
      shell: false,
    });
  } finally {
    process.umask(previousUmask);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("rendered systemd runtime commands", () => {
  it("runs strict app preflight directly through the selected Node and local tsx CLI", () => {
    const current = fixture();
    const result = runServicePreflight(current, "app");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("Service preflight: READY mode=app");
    expect(readdirSync(current.runtime)).toEqual([]);
  });

  it("fails direct preflight when a copied reviewed migration is altered", () => {
    const current = fixture();
    const migration = path.join(
      current.root,
      "drizzle",
      "0000_hesitant_yellow_claw.sql",
    );
    writeFileSync(migration, `${statSync(migration).size}\n`, { flag: "a" });
    const result = runServicePreflight(current, "app");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Migration SQL checksum failed");
    expect(readdirSync(current.runtime)).toEqual([]);
  });

  it("pins the preflight database before Next loads production environment variants", () => {
    const current = fixture();
    const variantDatabase = path.join(current.runtime, "variant.sqlite3");
    writeFileSync(
      path.join(current.root, ".env"),
      `DB_FILE_NAME=${current.databasePath}\nNEXT_MANUAL_SIG_HANDLE=1\n`,
    );
    writeFileSync(
      path.join(current.root, ".env.production.local"),
      `DB_FILE_NAME=${variantDatabase}\n`,
    );
    delete current.environment.DB_FILE_NAME;

    const preflight = runServicePreflight(current, "app");
    expect(preflight.status, preflight.stderr).toBe(0);
    const nextEnvironment = spawnSync(
      process.execPath,
      [
        "--require",
        path.join(SOURCE_ROOT, "scripts", "next-telemetry-disabled.cjs"),
        "--eval",
        [
          `require(${JSON.stringify(path.join(SOURCE_ROOT, "node_modules", "@next", "env"))}).loadEnvConfig(process.cwd(), false, console, true);`,
          "process.exitCode = process.env.DB_FILE_NAME === process.env.EXPECTED_DB && process.env.NEXT_MANUAL_SIG_HANDLE === '' ? 0 : 1;",
        ].join(""),
      ],
      {
        cwd: current.root,
        encoding: "utf8",
        env: { ...current.environment, EXPECTED_DB: current.databasePath },
        shell: false,
      },
    );

    expect(nextEnvironment.status, nextEnvironment.stderr).toBe(0);
    expect(existsSync(variantDatabase)).toBe(false);
    expect(readdirSync(current.runtime)).toEqual([]);
  });

  it("runs the direct backup command against only a live synthetic ledger", async () => {
    const current = fixture();
    const sqlite = new Database(current.databasePath);
    sqlite.pragma("journal_mode = WAL");
    migrate(drizzle(sqlite), { migrationsFolder: path.join(current.root, "drizzle") });
    sqlite
      .prepare(
        `INSERT INTO accounts
          (id, name, type, currency, opening_balance_cents, created_at, updated_at)
         VALUES ('systemd-synthetic', 'Systemd synthetic', 'CASH', 'USD', 0, 1, 1)`,
      )
      .run();
    for (const suffix of ["", "-wal", "-shm"]) {
      const target = `${current.databasePath}${suffix}`;
      if (existsSync(target)) chmodSync(target, 0o600);
    }
    try {
      const preflight = runServicePreflight(current, "backup");
      expect(preflight.status, preflight.stderr).toBe(0);
      expect(preflight.stdout.trim()).toBe("Service preflight: READY mode=backup");
      const result = spawnSync(
        process.execPath,
        [TSX_CLI, "--no-cache", BACKUP_SCRIPT, "--keep", "1"],
        {
          cwd: current.root,
          encoding: "utf8",
          env: current.environment,
          shell: false,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Backup publication: VALID");
      expect(result.stdout).toContain("Durability: confirmed");
      const backupDirectory = backupDirectoryForDatabase(current.databasePath);
      const finals = readdirSync(backupDirectory).filter((name) => name.endsWith(".sqlite3"));
      expect(finals).toHaveLength(1);
      const finalPath = path.join(backupDirectory, finals[0] ?? "");
      expect(statSync(backupDirectory).mode & 0o7777).toBe(0o700);
      expect(statSync(finalPath).mode & 0o7777).toBe(0o600);
      expect(
        validateBackupImageFile(
          finalPath,
          createBackupValidationOracle(path.join(current.root, "drizzle")),
        ).revision.kind,
      ).toBe("current");
    } finally {
      sqlite.close();
    }
  });
});
