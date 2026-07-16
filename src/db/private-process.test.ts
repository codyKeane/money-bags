import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  PrivateProcessUmaskError,
  enforcePrivateProcessUmask,
} from "./private-process";

const repositoryRoot = path.resolve(__dirname, "..", "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function source(relativePath: string): string {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function expectInOrder(contents: string, earlier: string, later: string): void {
  const earlierIndex = contents.indexOf(earlier);
  const laterIndex = contents.indexOf(later);
  expect(earlierIndex).toBeGreaterThanOrEqual(0);
  expect(laterIndex).toBeGreaterThan(earlierIndex);
}

describe("private SQLite process permissions", () => {
  const posixIt = process.platform === "win32" ? it.skip : it;

  posixIt("retains umask 0077 and creates a private DB, WAL, SHM, and directory", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "moneybags-private-process-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "runtime", "synthetic.sqlite");
    const helperUrl = pathToFileURL(
      path.join(repositoryRoot, "src", "db", "private-process.ts"),
    ).href;
    const clientUrl = pathToFileURL(path.join(repositoryRoot, "src", "db", "client.ts")).href;
    const childProgram = `
      import { statSync } from "node:fs";
      process.umask(0o022);
      const helperModule = await import(${JSON.stringify(helperUrl)});
      const { enforcePrivateProcessUmask } = helperModule.default ?? helperModule;
      enforcePrivateProcessUmask();
      const maskAfterFirstCall = process.umask(0o077);
      enforcePrivateProcessUmask();
      const maskAfterSecondCall = process.umask(0o077);

      process.umask(0o022);
      const clientModule = await import(${JSON.stringify(clientUrl)});
      const { createTestDb } = clientModule.default ?? clientModule;
      const databasePath = ${JSON.stringify(databasePath)};
      const sqlite = createTestDb(databasePath).sqlite;
      try {
        sqlite.exec("CREATE TABLE private_mode_probe (value TEXT NOT NULL); INSERT INTO private_mode_probe VALUES ('synthetic')");
        const mode = (target) => statSync(target).mode & 0o777;
        const observed = {
          maskAfterFirstCall,
          maskAfterSecondCall,
          maskAfterClientOpen: process.umask(0o077),
          directoryMode: mode(${JSON.stringify(path.dirname(databasePath))}),
          databaseMode: mode(databasePath),
          walMode: mode(databasePath + "-wal"),
          shmMode: mode(databasePath + "-shm"),
        };
        process.stdout.write(JSON.stringify(observed));
      } finally {
        sqlite.close();
      }
    `;

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", childProgram],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, TSX_DISABLE_CACHE: "1" },
        shell: false,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      maskAfterFirstCall: 0o077,
      maskAfterSecondCall: 0o077,
      maskAfterClientOpen: 0o077,
      directoryMode: 0o700,
      databaseMode: 0o600,
      walMode: 0o600,
      shmMode: 0o600,
    });
  });

  it("enforces the private mask before every in-scope production SQLite open", () => {
    const client = source("src/db/client.ts");
    const seedTarget = source("src/db/seed-target.ts");
    const transactionExport = source("src/server/services/transaction-export.ts");
    const drizzleConfig = source("drizzle.config.ts");

    for (const contents of [client, seedTarget, transactionExport, drizzleConfig]) {
      expect(contents).toContain("enforcePrivateProcessUmask");
    }
    expectInOrder(client, "enforcePrivateProcessUmask();", "new Database(file)");
    expectInOrder(
      seedTarget,
      "enforcePrivateProcessUmask();",
      "new Database(databasePath, { readonly: true, fileMustExist: true })",
    );
    expectInOrder(
      transactionExport,
      "enforcePrivateProcessUmask();",
      "new Database(databasePath, { readonly: true, fileMustExist: true })",
    );
    expectInOrder(drizzleConfig, "enforcePrivateProcessUmask();", "preflightDatabaseOpen();");
  });

  it("skips unsupported Windows mode claims and fails closed in worker threads", () => {
    const inherited = process.umask(0o022);
    try {
      enforcePrivateProcessUmask({ platform: "win32" });
      expect(process.umask(0o022)).toBe(0o022);
      expect(() =>
        enforcePrivateProcessUmask({ platform: "linux", mainThread: false }),
      ).toThrow(PrivateProcessUmaskError);
      expect(process.umask(0o022)).toBe(0o022);
    } finally {
      process.umask(inherited);
    }
  });
});
