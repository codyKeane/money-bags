import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import {
  BACKUP_FINAL_NAME_PATTERN,
  createValidatedBackup,
} from "./backup-publication";
import {
  backupDirectoryForDatabase,
  backupRootForDatabase,
} from "./backup-location";
import {
  BackupOperationalValidationError,
  createBackupValidationOracle,
} from "./backup-validation";
import { validateBackupImageFile } from "./backup-verifier";
import { findRepositoryRoot } from "./path";

const REPOSITORY_ROOT = findRepositoryRoot({ moduleDirectory: __dirname });
const MIGRATIONS_FOLDER = path.join(REPOSITORY_ROOT, "drizzle");
const ORIGINAL_UMASK = process.umask(0o077);
process.umask(ORIGINAL_UMASK);
const temporaryDirectories: string[] = [];

const UUIDS = [
  "10000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
  "40000000-0000-4000-8000-000000000004",
] as const;

afterEach(() => {
  process.umask(ORIGINAL_UMASK);
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTemp(): string {
  const root = mkdtempSync(path.join(tmpdir(), "moneybags-backup-publication-"));
  temporaryDirectories.push(root);
  return root;
}

function createLiveLedger(root: string, filename = "ledger.sqlite3"): {
  readonly file: string;
  readonly sqlite: Database.Database;
} {
  const runtime = path.join(root, "runtime");
  mkdirSync(runtime, { mode: 0o700, recursive: true });
  const file = path.join(runtime, filename);
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });
  sqlite
    .prepare(
      `INSERT INTO accounts
        (id, name, type, currency, opening_balance_cents, created_at, updated_at)
       VALUES ('wal-sentinel', 'Synthetic WAL Sentinel', 'CASH', 'USD', 0, 1, 1)`,
    )
    .run();
  return { file, sqlite };
}

function preflight(file: string) {
  return Object.freeze({
    repositoryRoot: REPOSITORY_ROOT,
    databasePath: file,
    migrationsFolder: MIGRATIONS_FOLDER,
  });
}

function backupNamesForDatabase(databasePath: string): string[] {
  const directory = backupDirectoryForDatabase(databasePath);
  return existsSync(directory) ? readdirSync(directory).sort() : [];
}

function backupNames(root: string): string[] {
  return backupNamesForDatabase(path.join(root, "runtime", "ledger.sqlite3"));
}

function createBackupDirectories(databasePath: string): string {
  const root = backupRootForDatabase(databasePath);
  const directory = backupDirectoryForDatabase(databasePath);
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(directory, { mode: 0o700 });
  return directory;
}

function digest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function copyThenAddForeignKeyViolation(
  sourcePath: string,
  partialPath: string,
): Promise<void> {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(partialPath);
  } finally {
    source.close();
  }
  const partial = new Database(partialPath, { fileMustExist: true });
  try {
    partial.pragma("foreign_keys = OFF");
    partial
      .prepare(
        `INSERT INTO transactions
          (id, date, description, amount_cents, account_id, created_at, updated_at)
         VALUES ('invalid-fk', '2026-01-01', 'Synthetic invalid FK', 1, 'missing', 1, 1)`,
      )
      .run();
  } finally {
    partial.close();
  }
}

describe("validated backup publication", () => {
  it("backs up a live WAL ledger and publishes only a private validated final", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    process.umask(0o022);
    try {
      const result = await createValidatedBackup({
        preflight: preflight(ledger.file),
        now: () => new Date("2026-07-15T12:34:56.789Z"),
        uuid: () => UUIDS[0],
      });
      const finalPath = path.join(result.backupDirectory, result.filename);

      expect(result.filename).toMatch(BACKUP_FINAL_NAME_PATTERN);
      expect(result.revision.kind).toBe("current");
      expect(result).toMatchObject({
        durability: "confirmed",
        filesystemPrivacy: "posix-modes-enforced",
      });
      expect(backupNames(root)).toEqual([result.filename]);
      expect(statSync(result.backupDirectory).mode & 0o777).toBe(0o700);
      expect(statSync(finalPath).mode & 0o777).toBe(0o600);
      expect(
        validateBackupImageFile(
          finalPath,
          createBackupValidationOracle(MIGRATIONS_FOLDER),
        ).revision.kind,
      ).toBe("current");

      const backup = new Database(finalPath, { readonly: true, fileMustExist: true });
      try {
        expect(
          backup
            .prepare("SELECT name FROM accounts WHERE id = 'wal-sentinel'")
            .get(),
        ).toEqual({ name: "Synthetic WAL Sentinel" });
      } finally {
        backup.close();
      }
    } finally {
      ledger.sqlite.close();
    }
  });

  it("cleans only its incomplete partial and preserves an earlier valid final", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    try {
      const previous = await createValidatedBackup({
        preflight: preflight(ledger.file),
        now: () => new Date("2026-07-15T12:00:00.000Z"),
        uuid: () => UUIDS[0],
      });
      const previousPath = path.join(previous.backupDirectory, previous.filename);
      const before = digest(previousPath);

      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          keep: 1,
          now: () => new Date("2026-07-15T13:00:00.000Z"),
          uuid: () => UUIDS[1],
          onlineBackup: async (_source, partial) => {
            writeFileSync(partial, "synthetic-incomplete-copy");
            throw new Error("injected copy failure");
          },
        }),
      ).rejects.toMatchObject({
        stage: "copy",
        outcome: "no-artifact",
      });

      expect(backupNames(root)).toEqual([previous.filename]);
      expect(digest(previousPath)).toBe(before);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("quarantines a complete logically invalid image and skips retention", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    try {
      const previous = await createValidatedBackup({
        preflight: preflight(ledger.file),
        now: () => new Date("2026-07-15T12:00:00.000Z"),
        uuid: () => UUIDS[0],
      });

      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          keep: 1,
          now: () => new Date("2026-07-15T13:00:00.000Z"),
          uuid: () => UUIDS[1],
          onlineBackup: copyThenAddForeignKeyViolation,
        }),
      ).rejects.toMatchObject({
        stage: "validation",
        outcome: "quarantined",
      });

      const names = backupNames(root);
      expect(names).toContain(previous.filename);
      expect(names.filter((name) => name.endsWith(".invalid"))).toHaveLength(1);
      expect(names.some((name) => name.endsWith(".partial"))).toBe(false);
      expect(names.filter((name) => BACKUP_FINAL_NAME_PATTERN.test(name))).toHaveLength(1);
      const invalid = names.find((name) => name.endsWith(".invalid"));
      expect(statSync(path.join(previous.backupDirectory, invalid ?? "")).mode & 0o777).toBe(
        0o600,
      );
    } finally {
      ledger.sqlite.close();
    }
  });

  it("quarantines a completed corrupt image rejected during normalization", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T13:00:00.000Z"),
          uuid: () => UUIDS[0],
          onlineBackup: async (_source, partial) => {
            writeFileSync(partial, Buffer.alloc(4_096, 0x5a));
          },
        }),
      ).rejects.toMatchObject({
        stage: "validation",
        outcome: "quarantined",
      });

      expect(backupNames(root).filter((name) => name.endsWith(".invalid"))).toHaveLength(1);
      expect(backupNames(root).some((name) => name.endsWith(".partial"))).toBe(false);
      expect(backupNames(root).some((name) => name.endsWith(".sqlite3"))).toBe(false);
    } finally {
      ledger.sqlite.close();
    }
  });

  it.each([
    { failure: "first-directory-sync", expectedPartial: true },
    { failure: "staging-unlink", expectedPartial: true },
    { failure: "second-directory-sync", expectedPartial: false },
  ] as const)(
    "reports a visible but durability-unconfirmed quarantine after $failure failure",
    async ({ failure, expectedPartial }) => {
      const root = makeTemp();
      const ledger = createLiveLedger(root);
      const backupDirectory = createBackupDirectories(ledger.file);
      let syncCount = 0;
      try {
        await expect(
          createValidatedBackup({
            preflight: preflight(ledger.file),
            keep: 1,
            now: () => new Date("2026-07-15T13:00:00.000Z"),
            uuid: () => UUIDS[0],
            onlineBackup: copyThenAddForeignKeyViolation,
            syncDirectory: (directory) => {
              if (directory !== backupDirectory) return;
              syncCount += 1;
              if (
                failure === "first-directory-sync" ||
                (failure === "second-directory-sync" && syncCount === 2)
              ) {
                throw new Error(`injected ${failure}`);
              }
            },
            removeFile: (target) => {
              if (failure === "staging-unlink" && target.endsWith(".partial")) {
                throw new Error("injected staging-unlink");
              }
              unlinkSync(target);
            },
          }),
        ).rejects.toMatchObject({
          stage: "quarantine",
          outcome: "quarantine-visible",
        });

        const names = backupNames(root);
        expect(names.filter((name) => name.endsWith(".invalid"))).toHaveLength(1);
        expect(names.some((name) => name.endsWith(".partial"))).toBe(expectedPartial);
        expect(names.some((name) => name.endsWith(".sqlite3"))).toBe(false);
      } finally {
        ledger.sqlite.close();
      }
    },
  );

  it("retains a complete image as partial when validation is indeterminate", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    const current = createBackupValidationOracle(MIGRATIONS_FOLDER).currentRevision;
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[0],
          oracle: {
            currentRevision: current,
            validate: () => {
              throw new BackupOperationalValidationError("injected I/O failure");
            },
          },
        }),
      ).rejects.toMatchObject({
        stage: "validation",
        outcome: "partial-retained",
      });

      expect(backupNames(root).filter((name) => name.endsWith(".partial"))).toHaveLength(1);
      expect(backupNames(root).some((name) => name.endsWith(".sqlite3"))).toBe(false);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("never overwrites preexisting partial or final names", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    const backups = createBackupDirectories(ledger.file);
    const stamp = "20260715T120000000Z";
    const partial = path.join(backups, `moneybags-${stamp}.${UUIDS[0]}.partial`);
    const final = path.join(backups, `moneybags-${stamp}-${UUIDS[1]}.sqlite3`);
    const sentinel = path.join(root, "collision-sentinel");
    writeFileSync(sentinel, "must-not-change");
    const sentinelDigest = digest(sentinel);
    symlinkSync(sentinel, partial);

    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[0],
        }),
      ).rejects.toMatchObject({ stage: "reserve", outcome: "no-artifact" });
      expect(digest(sentinel)).toBe(sentinelDigest);

      writeFileSync(final, "preexisting-final");
      const finalDigest = digest(final);
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[1],
        }),
      ).rejects.toMatchObject({ stage: "publication" });
      expect(digest(final)).toBe(finalDigest);
      expect(digest(sentinel)).toBe(sentinelDigest);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("creates distinct finals for concurrent fixed-clock runs", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    try {
      const [left, right] = await Promise.all([
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[0],
        }),
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[1],
        }),
      ]);

      expect(left.filename).not.toBe(right.filename);
      expect(backupNames(root)).toEqual([left.filename, right.filename].sort());
    } finally {
      ledger.sqlite.close();
    }
  });

  it("uses deterministic global ordering for concurrent keep-one retention", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    let arrivals = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const beforeRetention = async () => {
      arrivals += 1;
      if (arrivals === 2) release?.();
      await gate;
    };
    try {
      const [left, right] = await Promise.all([
        createValidatedBackup({
          preflight: preflight(ledger.file),
          keep: 1,
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[0],
          beforeRetention,
        }),
        createValidatedBackup({
          preflight: preflight(ledger.file),
          keep: 1,
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[1],
          beforeRetention,
        }),
      ]);

      expect(left.filename).not.toBe(right.filename);
      expect(left.pruned + right.pruned).toBe(1);
      expect(backupNames(root)).toEqual([right.filename]);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("isolates retention for two ledgers that share one parent", async () => {
    const root = makeTemp();
    const firstLedger = createLiveLedger(root, "ledger-a.sqlite3");
    const secondLedger = createLiveLedger(root, "ledger-b.sqlite3");
    try {
      const firstOld = await createValidatedBackup({
        preflight: preflight(firstLedger.file),
        now: () => new Date("2026-07-15T10:00:00.000Z"),
        uuid: () => UUIDS[0],
      });
      const secondOnly = await createValidatedBackup({
        preflight: preflight(secondLedger.file),
        keep: 1,
        now: () => new Date("2026-07-15T10:30:00.000Z"),
        uuid: () => UUIDS[1],
      });
      const firstNew = await createValidatedBackup({
        preflight: preflight(firstLedger.file),
        keep: 1,
        now: () => new Date("2026-07-15T11:00:00.000Z"),
        uuid: () => UUIDS[2],
      });

      expect(firstOld.backupDirectory).not.toBe(secondOnly.backupDirectory);
      expect(firstNew.pruned).toBe(1);
      expect(backupNamesForDatabase(firstLedger.file)).toEqual([firstNew.filename]);
      expect(backupNamesForDatabase(secondLedger.file)).toEqual([secondOnly.filename]);
    } finally {
      firstLedger.sqlite.close();
      secondLedger.sqlite.close();
    }
  });

  it("retains the final and skips retention when directory fsync fails after linking", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    const backupDirectory = createBackupDirectories(ledger.file);
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          keep: 1,
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[0],
          syncDirectory: (directory) => {
            if (directory !== backupDirectory) return;
            const error = new Error("injected directory fsync failure") as NodeJS.ErrnoException;
            error.code = "EIO";
            throw error;
          },
        }),
      ).rejects.toMatchObject({
        outcome: "published",
      });

      const names = backupNames(root);
      expect(names.filter((name) => name.endsWith(".sqlite3"))).toHaveLength(1);
      expect(names.filter((name) => name.endsWith(".partial"))).toHaveLength(1);
      expect(statSync(path.join(backupDirectory, names[0] ?? "")).nlink).toBe(2);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("retains the partial when file fsync fails before publication", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[0],
          syncFile: () => {
            throw new Error("injected file fsync failure");
          },
        }),
      ).rejects.toMatchObject({
        stage: "file-sync",
        outcome: "partial-retained",
      });
      expect(backupNames(root).filter((name) => name.endsWith(".partial"))).toHaveLength(1);
      expect(backupNames(root).some((name) => name.endsWith(".sqlite3"))).toBe(false);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("never deletes a linked final when staging unlink or the second directory fsync fails", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[0],
          removeFile: (target) => {
            if (target.endsWith(".partial")) {
              throw new Error("injected staging unlink failure");
            }
            unlinkSync(target);
          },
        }),
      ).rejects.toMatchObject({ outcome: "published" });
      expect(backupNames(root).filter((name) => name.endsWith(".sqlite3"))).toHaveLength(1);
      expect(backupNames(root).filter((name) => name.endsWith(".partial"))).toHaveLength(1);

      const secondRoot = makeTemp();
      const secondLedger = createLiveLedger(secondRoot);
      const secondBackupDirectory = createBackupDirectories(secondLedger.file);
      let syncCount = 0;
      try {
        await expect(
          createValidatedBackup({
            preflight: preflight(secondLedger.file),
            now: () => new Date("2026-07-15T12:00:00.000Z"),
            uuid: () => UUIDS[1],
            syncDirectory: (directory) => {
              if (directory !== secondBackupDirectory) return;
              syncCount += 1;
              if (syncCount === 2) {
                throw new Error("injected cleanup directory fsync failure");
              }
            },
          }),
        ).rejects.toMatchObject({ outcome: "published" });
        expect(
          backupNames(secondRoot).filter((name) => name.endsWith(".sqlite3")),
        ).toHaveLength(1);
        expect(
          backupNames(secondRoot).filter((name) => name.endsWith(".partial")),
        ).toHaveLength(0);
      } finally {
        secondLedger.sqlite.close();
      }
    } finally {
      ledger.sqlite.close();
    }
  });

  it("reports retention failure without rolling back either valid final", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    try {
      const first = await createValidatedBackup({
        preflight: preflight(ledger.file),
        now: () => new Date("2026-07-15T10:00:00.000Z"),
        uuid: () => UUIDS[0],
      });
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          keep: 1,
          now: () => new Date("2026-07-15T11:00:00.000Z"),
          uuid: () => UUIDS[1],
          removeFile: (target) => {
            if (target.endsWith(first.filename)) {
              throw new Error("injected retention unlink failure");
            }
            unlinkSync(target);
          },
        }),
      ).rejects.toMatchObject({ stage: "retention", outcome: "published" });

      expect(backupNames(root).filter((name) => name.endsWith(".sqlite3"))).toHaveLength(2);
      expect(backupNames(root).filter((name) => name.endsWith(".partial"))).toHaveLength(0);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("syncs completed retention deletions when a later deletion fails", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    try {
      const first = await createValidatedBackup({
        preflight: preflight(ledger.file),
        now: () => new Date("2026-07-15T09:00:00.000Z"),
        uuid: () => UUIDS[0],
      });
      const second = await createValidatedBackup({
        preflight: preflight(ledger.file),
        now: () => new Date("2026-07-15T10:00:00.000Z"),
        uuid: () => UUIDS[1],
      });
      let retentionRemovals = 0;
      let targetDirectorySyncs = 0;

      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          keep: 1,
          now: () => new Date("2026-07-15T11:00:00.000Z"),
          uuid: () => UUIDS[2],
          removeFile: (target) => {
            if (target.endsWith(".sqlite3")) {
              retentionRemovals += 1;
              if (retentionRemovals === 2) {
                throw new Error("injected second retention deletion failure");
              }
            }
            unlinkSync(target);
          },
          syncDirectory: (directory) => {
            if (directory === first.backupDirectory) targetDirectorySyncs += 1;
          },
        }),
      ).rejects.toMatchObject({ stage: "retention", outcome: "published" });

      expect(retentionRemovals).toBe(2);
      expect(targetDirectorySyncs).toBe(3);
      expect(existsSync(path.join(first.backupDirectory, first.filename))).toBe(false);
      expect(existsSync(path.join(second.backupDirectory, second.filename))).toBe(true);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("detects source and staging pathname swaps before publication", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[0],
          onPhase: (phase) => {
            if (phase !== "copy-complete") return;
            renameSync(ledger.file, `${ledger.file}.moved`);
            writeFileSync(ledger.file, "replacement source");
          },
        }),
      ).rejects.toMatchObject({ stage: "copy", outcome: "partial-retained" });
      expect(backupNames(root).some((name) => name.endsWith(".sqlite3"))).toBe(false);
    } finally {
      ledger.sqlite.close();
    }

    const stagingRoot = makeTemp();
    const stagingLedger = createLiveLedger(stagingRoot);
    const partialName = `moneybags-20260715T120000000Z.${UUIDS[1]}.partial`;
    const partialPath = path.join(
      backupDirectoryForDatabase(stagingLedger.file),
      partialName,
    );
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(stagingLedger.file),
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[1],
          onPhase: (phase) => {
            if (phase !== "copy-complete") return;
            renameSync(partialPath, `${partialPath}.swapped-out`);
            writeFileSync(partialPath, "replacement partial");
          },
        }),
      ).rejects.toMatchObject({ outcome: "partial-retained" });
      expect(backupNames(stagingRoot).some((name) => name.endsWith(".sqlite3"))).toBe(
        false,
      );
    } finally {
      stagingLedger.sqlite.close();
    }
  });

  it("keeps only the newest validated finals and ignores unrelated artifacts", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    try {
      const first = await createValidatedBackup({
        preflight: preflight(ledger.file),
        now: () => new Date("2026-07-15T10:00:00.000Z"),
        uuid: () => UUIDS[0],
      });
      const second = await createValidatedBackup({
        preflight: preflight(ledger.file),
        now: () => new Date("2026-07-15T11:00:00.000Z"),
        uuid: () => UUIDS[1],
      });
      const unrelated = path.join(first.backupDirectory, "unrelated.sqlite3");
      const partial = path.join(first.backupDirectory, "unrelated.partial");
      const invalid = path.join(first.backupDirectory, "unrelated.invalid");
      const symlink = path.join(
        first.backupDirectory,
        `moneybags-20260715T090000000Z-${UUIDS[3]}.sqlite3`,
      );
      writeFileSync(unrelated, "unrelated");
      writeFileSync(partial, "partial");
      writeFileSync(invalid, "invalid");
      symlinkSync(unrelated, symlink);

      const third = await createValidatedBackup({
        preflight: preflight(ledger.file),
        keep: 2,
        now: () => new Date("2026-07-15T12:00:00.000Z"),
        uuid: () => UUIDS[2],
      });

      expect(third.pruned).toBe(1);
      expect(existsSync(path.join(first.backupDirectory, first.filename))).toBe(false);
      expect(existsSync(path.join(first.backupDirectory, second.filename))).toBe(true);
      expect(existsSync(path.join(first.backupDirectory, third.filename))).toBe(true);
      for (const ignored of [unrelated, partial, invalid, symlink]) {
        expect(existsSync(ignored)).toBe(true);
      }
    } finally {
      ledger.sqlite.close();
    }
  });

  it("excludes an exact-name final with an adjacent SQLite sidecar from retention", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    try {
      const first = await createValidatedBackup({
        preflight: preflight(ledger.file),
        now: () => new Date("2026-07-15T10:00:00.000Z"),
        uuid: () => UUIDS[0],
      });
      const sidecar = path.join(first.backupDirectory, `${first.filename}-journal`);
      writeFileSync(sidecar, "synthetic adjacent sidecar");

      const second = await createValidatedBackup({
        preflight: preflight(ledger.file),
        keep: 1,
        now: () => new Date("2026-07-15T11:00:00.000Z"),
        uuid: () => UUIDS[1],
      });

      expect(second.pruned).toBe(0);
      expect(existsSync(path.join(first.backupDirectory, first.filename))).toBe(true);
      expect(existsSync(sidecar)).toBe(true);
      expect(existsSync(path.join(second.backupDirectory, second.filename))).toBe(true);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("fails before staging when a new backup-directory entry cannot be synced", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    const runtime = path.join(root, "runtime");
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          uuid: () => UUIDS[0],
          syncDirectory: (directory) => {
            expect(directory).toBe(runtime);
            throw new Error("injected parent-directory fsync failure");
          },
        }),
      ).rejects.toMatchObject({
        stage: "directory-sync",
        outcome: "no-artifact",
      });
      expect(backupNames(root)).toEqual([]);

      const synchronized: string[] = [];
      const result = await createValidatedBackup({
        preflight: preflight(ledger.file),
        uuid: () => UUIDS[1],
        syncDirectory: (directory) => {
          synchronized.push(directory);
        },
      });
      expect(synchronized.slice(0, 2)).toEqual([
        runtime,
        backupRootForDatabase(ledger.file),
      ]);
      expect(backupNames(root)).toEqual([result.filename]);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("refuses a permissive database parent before creating backup paths", async () => {
    if (process.platform === "win32") return;
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    const runtime = path.dirname(ledger.file);
    chmodSync(runtime, 0o770);
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          uuid: () => UUIDS[0],
        }),
      ).rejects.toMatchObject({ stage: "preflight", outcome: "no-artifact" });
      expect(statSync(runtime).mode & 0o777).toBe(0o770);
      expect(existsSync(backupRootForDatabase(ledger.file))).toBe(false);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("surfaces Windows best-effort durability and unverified ACL privacy", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    const runtime = path.dirname(ledger.file);
    chmodSync(runtime, 0o777);
    const backupDirectory = createBackupDirectories(ledger.file);
    chmodSync(backupRootForDatabase(ledger.file), 0o777);
    chmodSync(backupDirectory, 0o777);
    try {
      const result = await createValidatedBackup({
        preflight: preflight(ledger.file),
        platform: "win32",
        uuid: () => UUIDS[0],
      });

      expect(result).toMatchObject({
        durability: "platform-best-effort",
        filesystemPrivacy: "acl-unverified",
      });
      expect(statSync(backupDirectory).mode & 0o777).toBe(0o777);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("owns and classifies failures from phase observers after reservation/publication", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    const canInspectDescriptors = process.platform === "linux" && existsSync("/proc/self/fd");
    const descriptorsBefore = canInspectDescriptors
      ? readdirSync("/proc/self/fd").length
      : undefined;
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[0],
          onPhase: (phase) => {
            if (phase === "partial-reserved") {
              throw new Error("injected observer failure");
            }
          },
        }),
      ).rejects.toMatchObject({ stage: "reserve", outcome: "partial-retained" });
      if (descriptorsBefore !== undefined) {
        expect(readdirSync("/proc/self/fd").length).toBe(descriptorsBefore);
      }
      expect(backupNames(root).filter((name) => name.endsWith(".partial"))).toHaveLength(1);

      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T13:00:00.000Z"),
          uuid: () => UUIDS[1],
          onPhase: (phase) => {
            if (phase === "publication-complete") {
              throw new Error("injected published observer failure");
            }
          },
        }),
      ).rejects.toMatchObject({ stage: "publication", outcome: "published" });
      expect(backupNames(root).filter((name) => name.endsWith(".sqlite3"))).toHaveLength(1);
    } finally {
      ledger.sqlite.close();
    }
  });

  it.each([0o755, 0o1700])(
    "refuses an existing non-private backup directory mode %s without chmodding it",
    async (mode) => {
    const posixIt = process.platform !== "win32";
    if (!posixIt) return;
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    const backups = backupRootForDatabase(ledger.file);
    mkdirSync(backups, { mode });
    chmodSync(backups, mode);
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          uuid: () => UUIDS[0],
        }),
      ).rejects.toMatchObject({ stage: "directory", outcome: "no-artifact" });
      expect(statSync(backups).mode & 0o7777).toBe(mode);
      expect(readdirSync(backups)).toEqual([]);
    } finally {
      ledger.sqlite.close();
    }
    },
  );

  it("refuses a backup-directory symlink without modifying its target", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    const redirected = path.join(root, "redirected");
    mkdirSync(redirected, { mode: 0o700 });
    symlinkSync(redirected, path.join(root, "runtime", "backups"));
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          uuid: () => UUIDS[0],
        }),
      ).rejects.toMatchObject({ stage: "directory", outcome: "no-artifact" });
      expect(readdirSync(redirected)).toEqual([]);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("does not overwrite a final-name hardlink collision", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    const backups = createBackupDirectories(ledger.file);
    const sentinel = path.join(root, "hardlink-sentinel");
    writeFileSync(sentinel, "hardlink must not change");
    const final = path.join(
      backups,
      `moneybags-20260715T120000000Z-${UUIDS[0]}.sqlite3`,
    );
    linkSync(sentinel, final);
    const before = digest(sentinel);
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[0],
        }),
      ).rejects.toMatchObject({ stage: "publication" });
      expect(digest(sentinel)).toBe(before);
      expect(digest(final)).toBe(before);
    } finally {
      ledger.sqlite.close();
    }
  });

  it("reports published when a staging swap follows successful final linking", async () => {
    const root = makeTemp();
    const ledger = createLiveLedger(root);
    const partial = path.join(
      backupDirectoryForDatabase(ledger.file),
      `moneybags-20260715T120000000Z.${UUIDS[0]}.partial`,
    );
    try {
      await expect(
        createValidatedBackup({
          preflight: preflight(ledger.file),
          now: () => new Date("2026-07-15T12:00:00.000Z"),
          uuid: () => UUIDS[0],
          publishLink: (source, destination) => {
            linkSync(source, destination);
            renameSync(source, `${source}.moved-after-link`);
            writeFileSync(source, "replacement staging pathname");
          },
        }),
      ).rejects.toMatchObject({ outcome: "published" });
      expect(backupNames(root).filter((name) => name.endsWith(".sqlite3"))).toHaveLength(1);
      expect(existsSync(partial)).toBe(true);
    } finally {
      ledger.sqlite.close();
    }
  });
});
