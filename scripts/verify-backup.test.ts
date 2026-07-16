import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BackupLogicalValidationError } from "../src/db/backup-validation";
import { main } from "./verify-backup";

const repositoryRoot = path.resolve(__dirname, "..");
const candidate = path.join(repositoryRoot, "data", "backups", "synthetic.sqlite3");
const fakePreflight = Object.freeze({
  repositoryRoot,
  databasePath: path.join(repositoryRoot, "data", "live.sqlite3"),
  migrationsFolder: path.join(repositoryRoot, "drizzle"),
});
const fakeOracle = Object.freeze({
  currentRevision: Object.freeze({
    kind: "current" as const,
    index: 4,
    tag: "0004_right_gamma_corps",
  }),
  validate: () => ({
    kind: "current" as const,
    index: 4,
    tag: "0004_right_gamma_corps",
  }),
});

describe("backup verification CLI adapter", () => {
  it("prints only validation status and schema revision", () => {
    const output: string[] = [];
    const status = main([candidate], {
      preflight: () => fakePreflight,
      createOracle: () => fakeOracle,
      verify: () => ({
        identity: { device: BigInt(1), inode: BigInt(2) },
        revision: fakeOracle.currentRevision,
      }),
      log: (message) => output.push(message),
      logError: (message) => output.push(`unexpected:${message}`),
    });

    expect(status).toBe(0);
    expect(output).toEqual([
      "Backup verification: VALID",
      "Schema revision: current 0004_right_gamma_corps",
    ]);
    expect(output.join("\n")).not.toContain(candidate);
    expect(output.join("\n")).not.toMatch(/account|transaction|SELECT/i);
  });

  it("classifies logical failures without printing paths or validation rows", () => {
    const errors: string[] = [];
    const status = main([candidate], {
      preflight: () => fakePreflight,
      createOracle: () => fakeOracle,
      verify: () => {
        throw new BackupLogicalValidationError(
          "synthetic failure containing a path and row details",
        );
      },
      logError: (message) => errors.push(message),
    });

    expect(status).toBe(1);
    expect(errors).toEqual(["Backup verification: INVALID (logical)"]);
    expect(errors.join("\n")).not.toContain(candidate);
    expect(errors.join("\n")).not.toContain("row details");
  });

  it("requires exactly one explicit candidate before configured preflight", () => {
    for (const arguments_ of [[], [candidate, `${candidate}.second`]]) {
      let preflightCalled = false;
      const errors: string[] = [];
      const status = main(arguments_, {
        preflight: () => {
          preflightCalled = true;
          return fakePreflight;
        },
        logError: (message) => errors.push(message),
      });
      expect(status).toBe(1);
      expect(preflightCalled).toBe(false);
      expect(errors).toEqual(["Backup verification: INVALID (input)"]);
    }
  });

  it("does not import the auto-migrating client", () => {
    const source = readFileSync(
      path.join(repositoryRoot, "scripts", "verify-backup.ts"),
      "utf8",
    );
    expect(source).toContain("verifyStandaloneBackup");
    expect(source).not.toContain("db/client");
    expect(source).not.toContain("migrate(");
  });
});
