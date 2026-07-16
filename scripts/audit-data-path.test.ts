import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REVIEWED_MIGRATIONS } from "../src/db/migration-manifest";
import {
  backupDirectoryForDatabase,
  backupRootForDatabase,
} from "../src/db/backup-location";
import { findRepositoryRoot } from "../src/db/path";
import {
  auditConfiguredDataPath,
  auditResolvedDataPath,
  classifyResolvedDatabasePath,
  formatDataPathAudit,
  type GitCheckOptions,
  type SpawnGit,
} from "./audit-data-path";

const sourceRoot = findRepositoryRoot({ moduleDirectory: __dirname });
const temporaryDirectories: string[] = [];

function makeTemp(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function makeRepositoryFixture(): string {
  const root = makeTemp("moneybags-audit-root-");
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ moneybagsRepositoryRoot: true })}\n`,
  );
  mkdirSync(path.join(root, "bundle"));
  mkdirSync(path.join(root, "drizzle", "meta"), { recursive: true });
  copyFileSync(
    path.join(sourceRoot, "drizzle", "meta", "_journal.json"),
    path.join(root, "drizzle", "meta", "_journal.json"),
  );
  for (const migration of REVIEWED_MIGRATIONS) {
    copyFileSync(
      path.join(sourceRoot, "drizzle", `${migration.tag}.sql`),
      path.join(root, "drizzle", `${migration.tag}.sql`),
    );
  }
  return root;
}

function fakePreflight(repositoryRoot: string, databasePath: string) {
  return Object.freeze({
    repositoryRoot,
    databasePath,
    migrationsFolder: path.join(repositoryRoot, "drizzle"),
  });
}

function spawnWithStatus(status: number | null): SpawnGit {
  return (_command, arguments_, options) =>
    arguments_[0] === "rev-parse"
      ? { status: 0, stdout: `${options.cwd}\n` }
      : {
          status,
          stdout:
            status === 0
              ? ".gitignore\0" + "1\0/data/**\0" + (options.input ?? "")
              : "",
        };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("configured data-path audit", () => {
  it("audits the default repository-data target without creating it", () => {
    const root = makeRepositoryFixture();
    const target = path.join(root, "data", "finance.db");

    const report = auditConfiguredDataPath({
      environment: {},
      moduleDirectory: path.join(root, "bundle"),
      spawnGit: spawnWithStatus(0),
    });

    expect(report).toMatchObject({
      status: "pass",
      databasePath: target,
      classification: "repository-data",
      gitIgnore: "ignored",
      filesystemPrivacy: "pass",
    });
    expect(existsSync(path.dirname(target))).toBe(false);
  });

  it("clones the environment and resolves identically from an unrelated cwd", () => {
    const root = makeRepositoryFixture();
    const unrelated = makeTemp("moneybags-audit-cwd-");
    const target = path.join(root, "data", "ledger.sqlite3");
    const environment: Record<string, string | undefined> = {};
    writeFileSync(path.join(root, ".env"), `DB_FILE_NAME=${target}\n`);

    const first = auditConfiguredDataPath({
      environment,
      moduleDirectory: path.join(root, "bundle"),
      spawnGit: spawnWithStatus(0),
    });
    const originalCwd = process.cwd();
    let second;
    try {
      process.chdir(unrelated);
      second = auditConfiguredDataPath({
        environment,
        moduleDirectory: path.join(root, "bundle"),
        spawnGit: spawnWithStatus(0),
      });
    } finally {
      process.chdir(originalCwd);
    }

    expect(first).toEqual(second);
    expect(first.databasePath).toBe(target);
    expect(first.status).toBe("pass");
    expect(environment).toEqual({});
    expect(existsSync(path.dirname(target))).toBe(false);
  });

  it("does not create a missing external target or parent", () => {
    const root = makeRepositoryFixture();
    const externalRoot = makeTemp("moneybags-audit-external-");
    const missingParent = path.join(externalRoot, "not-created");
    const target = path.join(missingParent, "ledger.db");

    const report = auditConfiguredDataPath({
      environment: { DB_FILE_NAME: target },
      moduleDirectory: path.join(root, "bundle"),
    });

    expect(report).toMatchObject({
      status: "pass",
      classification: "external",
      gitIgnore: "not-applicable",
      parentMode: { state: "missing", display: "missing" },
      fileMode: { state: "missing", display: "missing" },
      filesystemPrivacy: "pass",
      backupRootDirectory: backupRootForDatabase(target),
      backupDirectory: backupDirectoryForDatabase(target),
    });
    expect(existsSync(missingParent)).toBe(false);
  });
});

describe("resolved data-path audit", () => {
  it("uses a bounded, non-shelling Git check for repository data", () => {
    const root = makeTemp("moneybags-audit-git-");
    const target = path.join(root, "data", "nested", "ledger.sqlite");
    const calls: Array<{
      command: string;
      arguments_: readonly string[];
      options: GitCheckOptions;
    }> = [];
    const spawnGit: SpawnGit = (command, arguments_, options) => {
      calls.push({ command, arguments_, options });
      return arguments_[0] === "rev-parse"
        ? { status: 0, stdout: `${options.cwd}\n` }
        : {
            status: 0,
            stdout: ".gitignore\0" + "1\0/data/**\0" + (options.input ?? ""),
          };
    };

    const inheritedGitDirectory = process.env.GIT_DIR;
    const inheritedConfigCount = process.env.GIT_CONFIG_COUNT;
    let report;
    try {
      process.env.GIT_DIR = path.join(root, "redirected.git");
      process.env.GIT_CONFIG_COUNT = "1";
      report = auditResolvedDataPath(fakePreflight(root, target), { spawnGit });
    } finally {
      if (inheritedGitDirectory === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = inheritedGitDirectory;
      if (inheritedConfigCount === undefined) delete process.env.GIT_CONFIG_COUNT;
      else process.env.GIT_CONFIG_COUNT = inheritedConfigCount;
    }

    expect(report.status).toBe("pass");
    expect(report.gitIgnore).toBe("ignored");
    expect(calls.map(({ command, arguments_ }) => ({ command, arguments_ }))).toEqual([
      {
        command: "git",
        arguments_: ["rev-parse", "--path-format=absolute", "--show-toplevel"],
      },
      {
        command: "git",
        arguments_: [
          "check-ignore",
          "--verbose",
          "--stdin",
          "-z",
        ],
      },
    ]);
    for (const { options } of calls) {
      expect(options).toMatchObject({
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 5_000,
        windowsHide: true,
      });
      expect(options.env.GIT_DIR).toBeUndefined();
      expect(options.env.GIT_CONFIG_COUNT).toBeUndefined();
      expect(options.env.GIT_LITERAL_PATHSPECS).toBeUndefined();
      expect(options.env).toMatchObject({
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      });
    }
    expect(calls[0]?.options.input).toBeUndefined();
    expect(calls[1]?.options.input).toBe("data/nested/ledger.sqlite\0");
  });

  it("fails with remediation when a repository data path is exposed", () => {
    const root = makeTemp("moneybags-audit-exposed-");
    const target = path.join(root, "data", "samples", "must-be-fake.db");
    const report = auditResolvedDataPath(fakePreflight(root, target), {
      spawnGit: spawnWithStatus(1),
    });

    expect(report.status).toBe("fail");
    expect(report.classification).toBe("repository-data");
    expect(report.gitIgnore).toBe("exposed");
    expect(report.remediation.join(" ")).toMatch(/samples.*ignored/i);
  });

  it("treats a tracked fake sample as exposed for use as a runtime target", () => {
    const target = path.join(
      sourceRoot,
      "data",
      "samples",
      "sample-statement.csv",
    );
    const report = auditResolvedDataPath(fakePreflight(sourceRoot, target), {
      platform: "win32",
    });

    expect(report.status).toBe("fail");
    expect(report.gitIgnore).toBe("exposed");
  });

  it("rejects a tracked synthetic runtime target without suggesting local deletion", () => {
    const root = makeTemp("moneybags-audit-tracked-runtime-");
    const target = path.join(root, "data", "ledger.db");
    mkdirSync(path.dirname(target));
    writeFileSync(
      path.join(root, ".gitignore"),
      "/data/**\n!/data/samples/\n!/data/samples/**\n",
    );
    writeFileSync(target, "synthetic fixture only\n");

    const initialized = spawnSync("git", ["init", "--quiet", root], {
      shell: false,
      stdio: "ignore",
      timeout: 5_000,
    });
    expect(initialized.error).toBeUndefined();
    expect(initialized.status).toBe(0);
    const tracked = spawnSync("git", ["add", "--force", "--", "data/ledger.db"], {
      cwd: root,
      shell: false,
      stdio: "ignore",
      timeout: 5_000,
    });
    expect(tracked.error).toBeUndefined();
    expect(tracked.status).toBe(0);

    const report = auditResolvedDataPath(fakePreflight(root, target), {
      platform: "win32",
    });

    expect(report.status).toBe("fail");
    expect(report.gitIgnore).toBe("exposed");
    expect(report.remediation.join(" ")).toMatch(
      /preserve the local ledger.*remove only its path.*never delete the local file/i,
    );
    expect(readFileSync(target, "utf8")).toBe("synthetic fixture only\n");
  });

  it.each([2, null])("fails closed when Git returns status %s", (status) => {
    const root = makeTemp("moneybags-audit-git-error-");
    const target = path.join(root, "data", "ledger.db");
    const report = auditResolvedDataPath(fakePreflight(root, target), {
      spawnGit: spawnWithStatus(status),
    });

    expect(report.status).toBe("fail");
    expect(report.gitIgnore).toBe("error");
    expect(report.remediation.join(" ")).toMatch(
      /Git.*root \.gitignore.*rerun/i,
    );
  });

  it("fails closed when Git reports another worktree or non-root ignore source", () => {
    const root = makeTemp("moneybags-audit-wrong-worktree-");
    const target = path.join(root, "data", "ledger.db");
    const wrongWorktree = auditResolvedDataPath(fakePreflight(root, target), {
      spawnGit: () => ({ status: 0, stdout: `${path.dirname(root)}\n` }),
    });
    expect(wrongWorktree).toMatchObject({ status: "fail", gitIgnore: "error" });

    const nonRootIgnore = auditResolvedDataPath(fakePreflight(root, target), {
      spawnGit: (_command, arguments_, options) =>
        arguments_[0] === "rev-parse"
          ? { status: 0, stdout: `${options.cwd}\n` }
          : {
              status: 0,
              stdout:
                ".git/info/exclude\0" +
                "1\0data/**\0" +
                (options.input ?? ""),
            },
    });
    expect(nonRootIgnore).toMatchObject({ status: "fail", gitIgnore: "error" });
  });

  it("fails permissive direct-parent and target POSIX modes with exact non-recursive remediation", () => {
    const root = makeTemp("moneybags-audit-modes-");
    const target = path.join(root, "data", "ledger.db");
    const inspected: string[] = [];
    const lstatPath = (candidate: string): Stats => {
      inspected.push(candidate);
      if (candidate === target) return { mode: 0o100640 } as Stats;
      if (candidate === path.dirname(target)) return { mode: 0o040750 } as Stats;
      const error = new Error("missing") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    };

    const report = auditResolvedDataPath(fakePreflight(root, target), {
      platform: "linux",
      spawnGit: spawnWithStatus(0),
      lstatPath,
    });

    expect(inspected).toEqual([
      backupRootForDatabase(target),
      backupDirectoryForDatabase(target),
      path.dirname(target),
      target,
      `${target}-wal`,
      `${target}-shm`,
    ]);
    expect(report.parentMode).toEqual({ state: "mode", display: "0750" });
    expect(report.fileMode).toEqual({ state: "mode", display: "0640" });
    expect(report.filesystemPrivacy).toBe("fail");
    expect(report.status).toBe("fail");
    expect(report.remediation).toContain(
      `Restrict the existing direct parent without recursion: chmod 0700 -- '${path.dirname(target)}'`,
    );
    expect(report.remediation).toContain(
      `Restrict the existing database file without recursion: chmod 0600 -- '${target}'`,
    );
    expect(report.remediation.join("\n")).not.toMatch(/chmod\s+-R\b/);
  });

  it("passes exact private POSIX modes and treats missing paths as non-violations", () => {
    const root = makeTemp("moneybags-audit-private-modes-");
    const target = path.join(root, "data", "ledger.db");
    const exactModes = auditResolvedDataPath(fakePreflight(root, target), {
      platform: "linux",
      spawnGit: spawnWithStatus(0),
      lstatPath: (candidate) => {
        if (new Set([
          path.dirname(target),
          backupRootForDatabase(target),
          backupDirectoryForDatabase(target),
        ]).has(candidate)) {
          return { mode: 0o040700 } as Stats;
        }
        return { mode: 0o100600 } as Stats;
      },
      readdirPath: () => [],
    });
    const missingModes = auditResolvedDataPath(fakePreflight(root, target), {
      platform: "linux",
      spawnGit: spawnWithStatus(0),
      lstatPath: () => {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    });

    expect(exactModes).toMatchObject({
      status: "pass",
      parentMode: { state: "mode", display: "0700" },
      fileMode: { state: "mode", display: "0600" },
      filesystemPrivacy: "pass",
    });
    expect(missingModes).toMatchObject({
      status: "pass",
      parentMode: { state: "missing", display: "missing" },
      fileMode: { state: "missing", display: "missing" },
      filesystemPrivacy: "pass",
    });
  });

  it("terminal-quotes exact chmod remediation without exposing shell syntax or controls", () => {
    const root = makeTemp("moneybags-audit-mode-output-");
    const target = path.join(
      root,
      "ledger'$(touch should-not-run)\n\u001b[31m.sqlite3",
    );
    const report = auditResolvedDataPath(fakePreflight(root, target), {
      platform: "linux",
      spawnGit: spawnWithStatus(0),
      lstatPath: (candidate) => {
        if (candidate === target) return { mode: 0o100644 } as Stats;
        if (candidate === path.dirname(target)) return { mode: 0o040700 } as Stats;
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    });
    const chmodRemediation = report.remediation.find((item) =>
      item.includes("chmod 0600"),
    );

    expect(chmodRemediation).toMatch(/^.*chmod 0600 -- \$'(?:\\x[0-9a-f]{2})+'$/u);
    expect(chmodRemediation).not.toContain("$(touch");
    expect(chmodRemediation).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
    expect(existsSync(path.join(root, "should-not-run"))).toBe(false);
  });

  it("reports Windows POSIX modes as inapplicable and ACL privacy as unverified", () => {
    const root = makeTemp("moneybags-audit-windows-");
    const target = path.join(root, "data", "ledger.db");
    const report = auditResolvedDataPath(fakePreflight(root, target), {
      platform: "win32",
      spawnGit: spawnWithStatus(0),
      lstatPath: () => {
        throw new Error("lstat must not run on Windows");
      },
    });

    expect(report.parentMode).toEqual({
      state: "not-applicable",
      display: "n/a (Windows; ACL privacy unverified)",
    });
    expect(report.fileMode).toEqual(report.parentMode);
    expect(report.walMode).toEqual(report.parentMode);
    expect(report.shmMode).toEqual(report.parentMode);
    expect(report.backupRootDirectoryMode).toEqual(report.parentMode);
    expect(report.backupDirectoryMode).toEqual(report.parentMode);
    expect(report.backupArtifactModes).toEqual([]);
    expect(report.filesystemPrivacy).toBe("unverified");
    expect(report.status).toBe("pass");
    expect(report.remediation.join(" ")).toMatch(
      /POSIX mode enforcement.*not applicable.*Windows.*ACL.*unverified/i,
    );
    expect(formatDataPathAudit(report)).toContain(
      "Data path audit: PASS (filesystem privacy unverified)",
    );
  });

  it("audits existing sidecars, backup directories, and recognized artifacts without recursion", () => {
    const root = makeTemp("moneybags-audit-private-artifacts-");
    const target = path.join(root, "data", "ledger.db");
    const backupRootDirectory = backupRootForDatabase(target);
    const backupDirectory = backupDirectoryForDatabase(target);
    const final =
      "moneybags-20260715T120000000Z-10000000-0000-4000-8000-000000000001.sqlite3";
    const invalid =
      "moneybags-20260715T120000000Z-20000000-0000-4000-8000-000000000002.invalid";
    const partial =
      "moneybags-20260715T120000000Z.30000000-0000-4000-8000-000000000003.partial";
    const legacy = "finance-2026-07-15T12-00-00.db";
    const linked =
      "moneybags-20260715T120000000Z-40000000-0000-4000-8000-000000000004.sqlite3";
    const modes = new Map<string, number>([
      [path.dirname(target), 0o040700],
      [target, 0o100600],
      [`${target}-wal`, 0o100644],
      [`${target}-shm`, 0o100600],
      [backupRootDirectory, 0o040700],
      [backupDirectory, 0o040755],
      [path.join(backupDirectory, final), 0o100644],
      [path.join(backupDirectory, invalid), 0o100600],
      [path.join(backupDirectory, partial), 0o100640],
      [path.join(backupRootDirectory, legacy), 0o100644],
      [path.join(backupDirectory, linked), 0o120777],
    ]);
    const report = auditResolvedDataPath(fakePreflight(root, target), {
      platform: "linux",
      spawnGit: spawnWithStatus(0),
      lstatPath: (candidate) => {
        const mode = modes.get(candidate);
        if (mode === undefined) {
          const error = new Error("missing") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        return { mode } as Stats;
      },
      readdirPath: (directory) =>
        directory === backupRootDirectory
          ? [legacy, "unrelated.txt"]
          : [final, invalid, partial, linked, "unrelated.txt"],
    });

    expect(report.status).toBe("fail");
    expect(report.filesystemPrivacy).toBe("fail");
    expect(report.walMode).toEqual({ state: "mode", display: "0644" });
    expect(report.shmMode).toEqual({ state: "mode", display: "0600" });
    expect(report.backupDirectoryMode).toEqual({ state: "mode", display: "0755" });
    expect(report.backupArtifactModes).toHaveLength(5);
    expect(
      report.backupArtifactModes.find((artifact) => artifact.path.endsWith(linked))?.mode
        .state,
    ).toBe("unsafe-type");
    const remediation = report.remediation.join("\n");
    expect(remediation).toContain("chmod 0600");
    expect(remediation).toContain("chmod 0700");
    expect(remediation).toContain(`${target}-wal`);
    expect(remediation).toContain(backupDirectory);
    expect(remediation).toContain(final);
    expect(remediation).toContain(partial);
    expect(remediation).toContain(legacy);
    expect(remediation).not.toContain("unrelated.txt");
    expect(remediation).not.toContain(`chmod 0600 -- '${path.join(backupDirectory, linked)}'`);
  });

  it("classifies only the preflight paths and fails repository-unsafe paths", () => {
    const root = makeTemp("moneybags-audit-classify-");
    const dataTarget = path.join(root, "data", "ledger.db");
    const unsafeTarget = path.join(root, "ledger.db");
    const externalTarget = path.join(makeTemp("moneybags-audit-classify-external-"), "db");

    expect(classifyResolvedDatabasePath(root, dataTarget)).toBe("repository-data");
    expect(classifyResolvedDatabasePath(root, unsafeTarget)).toBe("repository-unsafe");
    expect(classifyResolvedDatabasePath(root, externalTarget)).toBe("external");

    const unsafe = auditResolvedDataPath(fakePreflight(root, unsafeTarget), {
      spawnGit: () => {
        throw new Error("Git must not inspect an unsafe repository path");
      },
    });
    expect(unsafe.status).toBe("fail");
    expect(unsafe.gitIgnore).toBe("not-applicable");
    expect(unsafe.remediation.join(" ")).toMatch(/below data\/.*outside/i);
  });

  it("JSON-escapes paths before terminal output", () => {
    const root = makeTemp("moneybags-audit-output-");
    const unsafeParent = path.join(
      root,
      "line\n\u001b[31m\u0085\u061c\u2028\u2029\u202e\u2066",
    );
    const target = path.join(unsafeParent, "ledger.db");
    const report = auditResolvedDataPath(fakePreflight(root, target), {
      spawnGit: spawnWithStatus(0),
    });
    const output = formatDataPathAudit(report);

    expect(output).toContain("Resolved target: \"");
    expect(output).toContain("Target-scoped backup directory: \"");
    expect(output).toContain("\\n\\u001b[31m");
    for (const escaped of [
      "\\u0085",
      "\\u061c",
      "\\u2028",
      "\\u2029",
      "\\u202e",
      "\\u2066",
    ]) {
      expect(output).toContain(escaped);
    }
    for (const line of output.split("\n")) {
      expect(line).not.toMatch(
        /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u206f]/u,
      );
    }
    expect(existsSync(unsafeParent)).toBe(false);
  });

  it("has no SQLite client or driver import", () => {
    const source = readFileSync(path.join(sourceRoot, "scripts", "audit-data-path.ts"), "utf8");
    const packageJson = JSON.parse(
      readFileSync(path.join(sourceRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(source).toContain("preflightDatabaseOpen");
    expect(source).not.toContain("db/client");
    expect(source).not.toContain("better-sqlite3");
    expect(packageJson.scripts["audit:data-path"]).toBe(
      "node --import ./scripts/disable-tsx-cache.mjs --import tsx scripts/audit-data-path.ts",
    );
    expect(
      readFileSync(path.join(sourceRoot, "scripts", "disable-tsx-cache.mjs"), "utf8"),
    ).toContain('process.env.TSX_DISABLE_CACHE = "1"');
  });
});

describe("repository data Git boundary", () => {
  it("ignores runtime shapes and re-includes only fake samples", () => {
    const ignoredTargets = [
      "data/finance.db",
      "data/finance.sqlite",
      "data/custom/name.sqlite3",
      "data/custom/name.sqlite3-wal",
      "data/custom/name.sqlite3-shm",
      "data/imports/__wp12b-statement__.csv",
      "data/backups/__wp12b-backup__.sqlite3",
    ];

    for (const target of ignoredTargets) {
      const result = spawnSync(
        "git",
        ["check-ignore", "--quiet", "--no-index", "--", target],
        { cwd: sourceRoot, shell: false, stdio: "ignore", timeout: 5_000 },
      );
      expect(result.error, target).toBeUndefined();
      expect(result.status, target).toBe(0);
    }

    const fakeSample = spawnSync(
      "git",
      [
        "check-ignore",
        "--quiet",
        "--no-index",
        "--",
        "data/samples/__wp12b-trackable__.csv",
      ],
      { cwd: sourceRoot, shell: false, stdio: "ignore", timeout: 5_000 },
    );
    expect(fakeSample.error).toBeUndefined();
    expect(fakeSample.status).toBe(1);
  });
});
