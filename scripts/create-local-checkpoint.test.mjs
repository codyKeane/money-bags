import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main as createLocalCheckpoint } from "./create-local-checkpoint.mjs";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const CHECKPOINT_SCRIPT = path.join(
  PROJECT_ROOT,
  "scripts/create-local-checkpoint.mjs",
);
const temporaryRoots = [];

function run(command, arguments_, cwd, environment = {}) {
  return spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    shell: false,
    timeout: 15_000,
    windowsHide: true,
  });
}

function git(root, ...arguments_) {
  const result = run("git", arguments_, root);
  if (result.status !== 0) {
    throw new Error(`Synthetic Git fixture failed: ${arguments_[0] ?? "command"}`);
  }
  return result.stdout.trim();
}

function write(root, relative, contents) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

function fixture({ localIdentity = true, rootParent = tmpdir() } = {}) {
  const root = mkdtempSync(path.join(rootParent, "moneybags-checkpoint-test-"));
  temporaryRoots.push(root);
  write(
    root,
    "package.json",
    `${JSON.stringify({ moneybagsRepositoryRoot: true })}\n`,
  );
  write(root, ".gitignore", "data/**\n.env*\n");
  write(root, "selected.txt", "base selected\n");
  write(root, "unselected.txt", "base unselected\n");
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "add", "package.json", ".gitignore", "selected.txt", "unselected.txt");
  if (localIdentity) {
    git(root, "config", "user.name", "Synthetic Checkpoint");
    git(root, "config", "user.email", "checkpoint@example.invalid");
    git(root, "commit", "--quiet", "--message", "test: synthetic base");
  } else {
    git(
      root,
      "-c",
      "user.name=Synthetic Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "--message",
      "test: synthetic base",
    );
  }
  return root;
}

function checkpoint(root, arguments_, environment = {}, options = {}) {
  const previous = new Map(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, environment);
  let stdout = "";
  let stderr = "";
  const stdoutWrite = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((value) => {
      stdout += String(value);
      return true;
    });
  const stderrWrite = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((value) => {
      stderr += String(value);
      return true;
    });
  const consoleLog = vi.spyOn(console, "log").mockImplementation((...values) => {
    stdout += `${values.join(" ")}\n`;
  });
  const consoleError = vi.spyOn(console, "error").mockImplementation((...values) => {
    stderr += `${values.join(" ")}\n`;
  });
  try {
    return {
      status: createLocalCheckpoint(arguments_, {
        repositoryRoot: root,
        ...options,
      }),
      stdout,
      stderr,
    };
  } finally {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    consoleLog.mockRestore();
    consoleError.mockRestore();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function head(root) {
  return git(root, "rev-parse", "HEAD");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("local checkpoint CLI", () => {
  it("commits only selected tracked files and preserves unrelated work and handoff", () => {
    const root = fixture();
    write(root, "selected.txt", "checkpointed\n");
    write(root, "unselected.txt", "still working\n");
    write(root, "CODEX_HANDOFF.md", "untracked continuation\n");

    const result = checkpoint(root, [
      "--message",
      "feat: synthetic checkpoint",
      "--",
      "selected.txt",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/checkpoint: COMMITTED [a-f0-9]{7}/);
    expect(git(root, "show", "--format=", "--name-only", "HEAD")).toBe("selected.txt");
    expect(git(root, "show", "HEAD:selected.txt")).toBe("checkpointed");
    expect(run("git", ["status", "--short"], root).stdout).toBe(
      " M unselected.txt\n?? CODEX_HANDOFF.md\n",
    );
  });

  it("neutralizes hostile Git redirects and disables local commit hooks", () => {
    const root = fixture();
    const hostile = mkdtempSync(path.join(tmpdir(), "moneybags-hostile-git-"));
    temporaryRoots.push(hostile);
    const hookDirectory = path.join(root, "synthetic-hooks");
    const sentinel = path.join(hostile, "hook-ran");
    mkdirSync(hookDirectory);
    const hook = write(
      root,
      "synthetic-hooks/post-commit",
      `#!/bin/sh\nprintf unsafe > \"${sentinel}\"\n`,
    );
    chmodSync(hook, 0o755);
    git(root, "config", "core.hooksPath", hookDirectory);
    write(root, "selected.txt", "safe checkpoint\n");

    const result = checkpoint(
      root,
      ["--message", "fix: hostile environment", "--", "selected.txt"],
      {
        GIT_DIR: path.join(hostile, "not-a-repository"),
        GIT_WORK_TREE: hostile,
        GIT_INDEX_FILE: path.join(hostile, "index"),
      },
    );

    expect(result.status).toBe(0);
    expect(existsSync(sentinel)).toBe(false);
    expect(git(root, "show", "HEAD:selected.txt")).toBe("safe checkpoint");
  });

  it("commits an explicitly selected new file without adding the handoff", () => {
    const root = fixture();
    write(root, "new-module.txt", "new module\n");
    write(root, "CODEX_HANDOFF.md", "handoff\n");

    const result = checkpoint(root, [
      "--message",
      "feat: explicit new file",
      "--new-file",
      "new-module.txt",
      "--",
    ]);

    expect(result.status).toBe(0);
    expect(git(root, "show", "--format=", "--name-only", "HEAD")).toBe("new-module.txt");
    expect(git(root, "show", "HEAD:new-module.txt")).toBe("new module");
    expect(run("git", ["status", "--short"], root).stdout).toBe(
      "?? CODEX_HANDOFF.md\n",
    );
  });

  it("refuses pre-existing staging without changing HEAD or the index", () => {
    const root = fixture();
    write(root, "selected.txt", "staged by user\n");
    git(root, "add", "selected.txt");
    const originalHead = head(root);

    const result = checkpoint(root, [
      "--message",
      "fix: must refuse staging",
      "--",
      "selected.txt",
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Pre-existing staged changes/);
    expect(head(root)).toBe(originalHead);
    expect(git(root, "diff", "--cached", "--name-only")).toBe("selected.txt");
  });

  it("refuses and preserves a pre-existing intent-to-add index entry", () => {
    const root = fixture();
    write(root, "new-module.txt", "intent to add\n");
    git(root, "add", "--intent-to-add", "new-module.txt");
    const originalHead = head(root);

    const result = checkpoint(root, [
      "--message",
      "fix: must refuse intent to add",
      "--",
      "new-module.txt",
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(
      /Pre-existing added or intent-to-add index entries/,
    );
    expect(head(root)).toBe(originalHead);
    expect(run("git", ["status", "--short"], root).stdout).toBe(
      " A new-module.txt\n",
    );
  });

  it.each([
    ["untracked file", "new.txt", "new\n"],
    ["handoff", "CODEX_HANDOFF.md", "handoff\n"],
    ["environment file", ".env.example", "synthetic\n"],
    ["data file", "data/synthetic.txt", "synthetic\n"],
    ["import file", "imports/synthetic.csv", "synthetic\n"],
    ["backup file", "backups/synthetic.archive", "synthetic\n"],
    ["SQLite file", "synthetic.sqlite3", "synthetic\n"],
    ["private key", "synthetic.pem", "synthetic\n"],
    ["credential file", "secrets/token.txt", "synthetic\n"],
    ["directory", "directory", undefined],
  ])("refuses a selected %s", (_label, selected, contents) => {
    const root = fixture();
    write(root, "selected.txt", "eligible\n");
    if (contents === undefined) mkdirSync(path.join(root, selected));
    else write(root, selected, contents);
    const originalHead = head(root);

    const result = checkpoint(root, [
      "--message",
      "fix: refused selection",
      "--",
      selected,
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/checkpoint: REFUSED/);
    expect(head(root)).toBe(originalHead);
    expect(git(root, "diff", "--cached", "--name-only")).toBe("");
  });

  it.each([
    ["../outside.txt", false],
    ["/absolute.txt", false],
    ["selected*.txt", false],
    ["selected.txt", false],
    ["selected.txt", true],
  ])(
    "refuses invalid, unchanged, or duplicate path selection %j",
    (selected, duplicate) => {
      const root = fixture();
      const arguments_ = ["--message", "fix: refused path", "--", selected];
      if (duplicate) arguments_.push(selected);
      const originalHead = head(root);

      const result = checkpoint(root, arguments_);

      expect(result.status).toBe(2);
      expect(head(root)).toBe(originalHead);
      expect(git(root, "diff", "--cached", "--name-only")).toBe("");
    },
  );

  it("refuses tracked deletions, detached HEAD, and in-progress operations", () => {
    for (const state of ["deleted", "detached", "merge"]) {
      const root = fixture();
      write(root, "selected.txt", "changed\n");
      if (state === "deleted") rmSync(path.join(root, "selected.txt"));
      if (state === "detached") git(root, "checkout", "--quiet", "--detach");
      if (state === "merge") write(root, ".git/MERGE_HEAD", "synthetic\n");
      const originalHead = head(root);

      const result = checkpoint(root, [
        "--message",
        "fix: refused repository state",
        "--",
        "selected.txt",
      ]);

      expect(result.status).toBe(2);
      expect(head(root)).toBe(originalHead);
      expect(git(root, "diff", "--cached", "--name-only")).toBe("");
    }
  });

  it("refuses before mutation when no effective Git identity exists", () => {
    const root = fixture({ localIdentity: false });
    const emptyHome = path.join(root, "empty-home");
    mkdirSync(emptyHome);
    write(root, "selected.txt", "cannot commit without identity\n");
    const originalHead = head(root);

    const result = checkpoint(
      root,
      [
        "--message",
        "fix: missing identity",
        "--",
        "selected.txt",
      ],
      {
        HOME: emptyHome,
        XDG_CONFIG_HOME: emptyHome,
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Effective Git user\.name is unavailable/);
    expect(head(root)).toBe(originalHead);
    expect(git(root, "diff", "--cached", "--name-only")).toBe("");
    expect(git(root, "diff", "--name-only")).toBe("selected.txt");
  });

  it("removes only helper-owned new-file staging when Git refuses the commit", () => {
    const root = fixture();
    write(root, "new-module.txt", "new module\n");
    write(root, ".git/refs/heads/main.lock", "synthetic ref lock\n");
    const originalHead = head(root);

    const result = checkpoint(root, [
      "--message",
      "fix: synthetic commit refusal",
      "--new-file",
      "new-module.txt",
      "--",
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Git -c failed/);
    expect(head(root)).toBe(originalHead);
    expect(git(root, "diff", "--cached", "--name-only")).toBe("");
    expect(run("git", ["status", "--short"], root).stdout).toBe(
      "?? new-module.txt\n",
    );
  });

  it("refuses new-file whitespace errors and removes helper-owned staging", () => {
    const root = fixture();
    write(root, "new-module.txt", "trailing whitespace \n");
    const originalHead = head(root);

    const result = checkpoint(root, [
      "--message",
      "fix: reject whitespace error",
      "--new-file",
      "new-module.txt",
      "--",
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Git diff failed/);
    expect(head(root)).toBe(originalHead);
    expect(git(root, "diff", "--cached", "--name-only")).toBe("");
    expect(run("git", ["status", "--short"], root).stdout).toBe(
      "?? new-module.txt\n",
    );
  });

  it("runs through npm with identity available only from global config", () => {
    const root = fixture({
      localIdentity: false,
      rootParent: PROJECT_ROOT,
    });
    const syntheticHome = path.join(root, "synthetic-home");
    const syntheticXdg = path.join(root, "synthetic-xdg");
    mkdirSync(path.join(root, "scripts"));
    mkdirSync(syntheticHome);
    mkdirSync(syntheticXdg);
    copyFileSync(
      CHECKPOINT_SCRIPT,
      path.join(root, "scripts/create-local-checkpoint.mjs"),
    );
    write(
      root,
      "package.json",
      `${JSON.stringify({
        moneybagsRepositoryRoot: true,
        scripts: {
          checkpoint: "node scripts/create-local-checkpoint.mjs",
        },
      })}\n`,
    );
    write(
      root,
      "synthetic-home/.gitconfig",
      [
        "[user]",
        "\tname = Synthetic Global Identity",
        "\temail = global@example.invalid",
        "[core]",
        `\texcludesFile = ${path.join(syntheticHome, "global-ignore")}`,
        "",
      ].join("\n"),
    );
    write(root, "synthetic-home/global-ignore", "*.machine-only\n");
    write(root, "selected.txt", "executable boundary\n");

    const result = run(
      "npm",
      [
        "run",
        "checkpoint",
        "--",
        "--message",
        "fix: executable boundary",
        "--",
        "selected.txt",
      ],
      root,
      {
        HOME: syntheticHome,
        XDG_CONFIG_HOME: syntheticXdg,
      },
    );

    expect(result.status).toBe(0);
    expect(run("git", ["config", "--local", "--get", "user.name"], root).status).toBe(1);
    expect(git(root, "show", "--format=", "--name-only", "HEAD")).toBe(
      "selected.txt",
    );
    expect(git(root, "log", "-1", "--format=%an <%ae>")).toBe(
      "Synthetic Global Identity <global@example.invalid>",
    );

    write(root, "local.machine-only", "globally ignored\n");
    const committedHead = head(root);
    const ignoredResult = run(
      "npm",
      [
        "run",
        "checkpoint",
        "--",
        "--message",
        "fix: must refuse global ignore",
        "--new-file",
        "local.machine-only",
        "--",
      ],
      root,
      {
        HOME: syntheticHome,
        XDG_CONFIG_HOME: syntheticXdg,
      },
    );

    expect(ignoredResult.status).toBe(2);
    expect(head(root)).toBe(committedHead);
    expect(git(root, "diff", "--cached", "--name-only")).toBe("");
  });

  it("reports a created commit distinctly when post-verification fails", () => {
    const root = fixture();
    write(root, "selected.txt", "committed before synthetic verification failure\n");
    const originalHead = head(root);
    const result = checkpoint(
      root,
      ["--message", "fix: post verification signal", "--", "selected.txt"],
      {},
      {
        afterCommit() {
          throw new Error("synthetic post-commit failure");
        },
      },
    );

    expect(result.status).toBe(3);
    expect(head(root)).not.toBe(originalHead);
    expect(result.stderr).toMatch(
      /COMMITTED_WITH_VERIFICATION_FAILURE .* synthetic post-commit failure Do not retry; inspect HEAD\./,
    );
  });
});
