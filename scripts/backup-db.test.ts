import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./backup-db";

const repositoryRoot = path.resolve(__dirname, "..");
const fakePreflight = Object.freeze({
  repositoryRoot,
  databasePath: path.join(repositoryRoot, "data", "synthetic.sqlite3"),
  migrationsFolder: path.join(repositoryRoot, "drizzle"),
});

describe("backup CLI adapter", () => {
  it("passes bounded retention to the protocol and emits no database content", async () => {
    const output: string[] = [];
    const observedKeep: Array<number | undefined> = [];

    const status = await main(["--keep", "14"], {
      preflight: () => fakePreflight,
      createBackup: async (options) => {
        observedKeep.push(options.keep);
        return {
          backupDirectory: path.join(repositoryRoot, "data", "backups"),
          filename:
            "moneybags-20260715T120000000Z-10000000-0000-4000-8000-000000000001.sqlite3",
          revision: {
            kind: "current",
            index: 5,
            tag: "0005_annotations",
          },
          pruned: 2,
          durability: "confirmed",
          filesystemPrivacy: "posix-modes-enforced",
        };
      },
      log: (message) => output.push(message),
      logError: (message) => output.push(`unexpected:${message}`),
    });

    expect(status).toBe(0);
    expect(observedKeep).toEqual([14]);
    expect(output.join("\n")).toContain("Backup publication: VALID");
    expect(output.join("\n")).toContain("Schema revision: current 0005_annotations");
    expect(output.join("\n")).toContain("Retention pruned: 2");
    expect(output.join("\n")).toContain("Durability: confirmed");
    expect(output.join("\n")).toContain("Filesystem privacy: POSIX modes enforced");
    expect(output.join("\n")).not.toMatch(/Synthetic Account|wal-sentinel|SELECT/i);
  });

  it("discloses Windows best-effort durability and unverified ACL privacy", async () => {
    const output: string[] = [];
    const status = await main([], {
      preflight: () => fakePreflight,
      createBackup: async () => ({
        backupDirectory: path.join(repositoryRoot, "data", "backups", "target-synthetic"),
        filename:
          "moneybags-20260715T120000000Z-10000000-0000-4000-8000-000000000001.sqlite3",
        revision: { kind: "current", index: 5, tag: "0005_annotations" },
        pruned: 0,
        durability: "platform-best-effort",
        filesystemPrivacy: "acl-unverified",
      }),
      log: (message) => output.push(message),
    });

    expect(status).toBe(0);
    expect(output).toContain(
      "Durability: platform-best-effort (Windows directory fsync unavailable)",
    );
    expect(output).toContain(
      "Filesystem privacy: unverified (Windows ACLs not enforced)",
    );
  });

  it.each(["0", "-1", "1.5", "10001", "not-a-number"])(
    "rejects unsafe --keep value %s before preflight",
    async (keep) => {
      let preflightCalled = false;
      const errors: string[] = [];
      const status = await main(["--keep", keep], {
        preflight: () => {
          preflightCalled = true;
          return fakePreflight;
        },
        logError: (message) => errors.push(message),
      });

      expect(status).toBe(1);
      expect(preflightCalled).toBe(false);
      expect(errors).toEqual([
        "Backup publication: FAILED",
        "Stage: preflight",
        "Artifact state: no-artifact",
      ]);
    },
  );

  it("keeps the CLI thin and provides the documented package commands", () => {
    const source = readFileSync(path.join(repositoryRoot, "scripts", "backup-db.ts"), "utf8");
    const packageJson = JSON.parse(
      readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(source).toContain("createValidatedBackup");
    expect(source).not.toContain("better-sqlite3");
    expect(source).not.toContain("db/client");
    expect(packageJson.scripts["db:backup"]).toBe("tsx scripts/backup-db.ts");
    expect(packageJson.scripts["db:verify-backup"]).toBe(
      "tsx scripts/verify-backup.ts",
    );
  });
});
