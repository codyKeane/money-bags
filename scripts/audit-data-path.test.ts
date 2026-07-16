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
      backupDirectory: path.join(missingParent, "backups"),
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

  it("reports only the direct parent and target POSIX modes", () => {
    const root = makeTemp("moneybags-audit-modes-");
    const target = path.join(root, "data", "ledger.db");
    const inspected: string[] = [];
    const lstatPath = (candidate: string): Stats => {
      inspected.push(candidate);
      return { mode: candidate === target ? 0o100640 : 0o040750 } as Stats;
    };

    const report = auditResolvedDataPath(fakePreflight(root, target), {
      platform: "linux",
      spawnGit: spawnWithStatus(0),
      lstatPath,
    });

    expect(inspected).toEqual([path.dirname(target), target]);
    expect(report.parentMode).toEqual({ state: "mode", display: "0750" });
    expect(report.fileMode).toEqual({ state: "mode", display: "0640" });
  });

  it("reports explicit Windows mode n/a without touching either path", () => {
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
      display: "n/a (Windows)",
    });
    expect(report.fileMode).toEqual(report.parentMode);
    expect(report.status).toBe("pass");
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
    expect(output).toContain("Backup directory: \"");
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
