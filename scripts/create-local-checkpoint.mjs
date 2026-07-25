#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const GIT_TIMEOUT_MS = 120_000;
const MAX_MESSAGE_LENGTH = 120;
const MAX_SELECTED_FILES = 200;
const HANDOFF_PATH = "CODEX_HANDOFF.md";
const SQLITE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const SQLITE_SIDECARS = ["-journal", "-shm", "-wal"];
const SENSITIVE_COMPONENTS = new Set([
  ".gnupg",
  ".ssh",
  "credentials",
  "secrets",
]);
const SENSITIVE_FILENAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
  "token",
  "token.json",
]);
const SENSITIVE_EXTENSIONS = new Set([
  ".key",
  ".kdbx",
  ".p12",
  ".pem",
  ".pfx",
]);
const IN_PROGRESS_MARKERS = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
  "rebase-merge",
  "rebase-apply",
  "sequencer",
];

function refuse(message) {
  const error = new Error(message);
  error.code = "ERR_CHECKPOINT_REFUSED";
  throw error;
}

function gitEnvironment(overrides = {}) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^GIT_/iu.test(key)) delete environment[key];
  }
  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_EDITOR: "true",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_SEQUENCE_EDITOR: "true",
    GIT_TERMINAL_PROMPT: "0",
    ...overrides,
  };
}

function userConfigEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^GIT_/iu.test(key)) delete environment[key];
  }
  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function runUserConfigGit(repositoryRoot, arguments_, expectedStatuses = [0]) {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: userConfigEnvironment(),
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (
    result.error !== undefined ||
    result.status === null ||
    !expectedStatuses.includes(result.status)
  ) {
    refuse(`Git ${arguments_[0] ?? "command"} failed.`);
  }
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function runGit(repositoryRoot, arguments_, expectedStatuses = [0], overrides = {}) {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: gitEnvironment(overrides),
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (
    result.error !== undefined ||
    result.status === null ||
    !expectedStatuses.includes(result.status)
  ) {
    refuse(`Git ${arguments_[0] ?? "command"} failed.`);
  }
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function readEffectiveIdentity(repositoryRoot, key) {
  const result = runUserConfigGit(
    repositoryRoot,
    ["config", "--get", key],
    [0, 1],
  );
  if (result.status !== 0) {
    refuse(`Effective Git ${key} is unavailable.`);
  }
  const value = result.stdout.replace(/\r?\n$/u, "");
  if (
    value.length === 0 ||
    value.length > 320 ||
    /[\u0000-\u001f\u007f\r\n]/u.test(value)
  ) {
    refuse(`Effective Git ${key} is invalid.`);
  }
  return value;
}

function parseArguments(arguments_) {
  let message;
  const files = [];
  const newFiles = [];
  let readingFiles = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (readingFiles) {
      files.push(argument);
      continue;
    }
    if (argument === "--") {
      readingFiles = true;
      continue;
    }
    if (argument === "--message") {
      if (message !== undefined) refuse("--message may be supplied only once.");
      message = arguments_[index + 1];
      index += 1;
      if (message === undefined) refuse("--message requires a value.");
      continue;
    }
    if (argument === "--new-file") {
      const newFile = arguments_[index + 1];
      index += 1;
      if (newFile === undefined) refuse("--new-file requires a value.");
      newFiles.push(newFile);
      continue;
    }
    refuse(`Unknown checkpoint option: ${String(argument)}`);
  }
  if (!readingFiles) refuse("Use -- before the explicit tracked file list.");
  if (
    typeof message !== "string" ||
    message.length === 0 ||
    message.trim() !== message ||
    message.length > MAX_MESSAGE_LENGTH ||
    /[\u0000-\u001f\u007f\r\n]/u.test(message)
  ) {
    refuse("Commit message must be one trimmed printable line of 1 to 120 characters.");
  }
  if (
    files.length + newFiles.length === 0 ||
    files.length + newFiles.length > MAX_SELECTED_FILES
  ) {
    refuse("Select between 1 and 200 tracked or explicit new files.");
  }
  const allFiles = [...files, ...newFiles];
  if (new Set(allFiles).size !== allFiles.length) {
    refuse("Each selected file may be listed only once.");
  }
  return { message, files, newFiles };
}

function normalizeSelectedPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f:*?[\]]/u.test(value) ||
    path.posix.isAbsolute(value)
  ) {
    refuse("Selected paths must be literal repository-relative POSIX paths.");
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    refuse("Selected paths must not contain traversal or normalization aliases.");
  }
  const lower = normalized.toLowerCase();
  const basename = path.posix.basename(lower);
  const components = lower.split("/");
  const extension = path.posix.extname(basename);
  if (
    lower === HANDOFF_PATH.toLowerCase() ||
    lower === ".git" ||
    lower.startsWith(".git/") ||
    lower === "data" ||
    lower.startsWith("data/") ||
    lower === "imports" ||
    lower.startsWith("imports/") ||
    lower === "backups" ||
    lower.startsWith("backups/") ||
    components.some((component) => SENSITIVE_COMPONENTS.has(component)) ||
    basename.startsWith(".env") ||
    SENSITIVE_FILENAMES.has(basename) ||
    SENSITIVE_EXTENSIONS.has(extension) ||
    SQLITE_EXTENSIONS.has(extension) ||
    SQLITE_SIDECARS.some((suffix) => basename.endsWith(suffix)) ||
    lower === "node_modules" ||
    lower.startsWith("node_modules/") ||
    lower === ".next" ||
    lower.startsWith(".next/")
  ) {
    refuse(`Selected path is outside the autonomous checkpoint boundary: ${normalized}`);
  }
  return normalized;
}

function nulSeparated(value) {
  return value.split("\0").filter(Boolean);
}

function samePathSet(actual, expected) {
  if (actual.length !== expected.length) return false;
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.every((value, index) => value === right[index]);
}

function repositoryPreflight(repositoryRootOverride) {
  const repositoryRoot = realpathSync.native(
    repositoryRootOverride ?? path.resolve(import.meta.dirname, ".."),
  );
  if (
    repositoryRootOverride === undefined &&
    realpathSync.native(process.cwd()) !== repositoryRoot
  ) {
    refuse("Run the checkpoint command from the Money Bags repository root.");
  }
  let packageMetadata;
  try {
    packageMetadata = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  } catch {
    refuse("Money Bags package metadata is unavailable.");
  }
  if (packageMetadata?.moneybagsRepositoryRoot !== true) {
    refuse("The repository root marker is missing.");
  }
  const topLevel = runGit(repositoryRoot, ["rev-parse", "--show-toplevel"]).stdout.trim();
  if (realpathSync.native(topLevel) !== repositoryRoot) {
    refuse("Git resolved a different repository root.");
  }
  const gitDirectoryValue = runGit(repositoryRoot, ["rev-parse", "--git-dir"]).stdout.trim();
  const gitDirectory = realpathSync.native(path.resolve(repositoryRoot, gitDirectoryValue));
  const identity = {
    name: readEffectiveIdentity(repositoryRoot, "user.name"),
    email: readEffectiveIdentity(repositoryRoot, "user.email"),
  };
  return { repositoryRoot, gitDirectory, identity };
}

function validateRepositoryState(repositoryRoot, gitDirectory) {
  const symbolicHead = runGit(
    repositoryRoot,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    [0, 1],
  );
  if (symbolicHead.status !== 0 || symbolicHead.stdout.trim().length === 0) {
    refuse("Detached HEAD checkpoints are not allowed.");
  }
  for (const marker of IN_PROGRESS_MARKERS) {
    if (existsSync(path.join(gitDirectory, marker))) {
      refuse("A merge, rebase, cherry-pick, revert, or bisect is in progress.");
    }
  }
  const conflicts = nulSeparated(
    runGit(repositoryRoot, ["diff", "--name-only", "--diff-filter=U", "-z"]).stdout,
  );
  if (conflicts.length > 0) refuse("Resolve all Git conflicts before checkpointing.");
  const staged = runGit(repositoryRoot, ["diff", "--cached", "--quiet"], [0, 1]);
  if (staged.status !== 0) {
    refuse("Pre-existing staged changes must be committed or unstaged separately.");
  }
  const headPaths = new Set(
    nulSeparated(
      runGit(repositoryRoot, ["ls-tree", "-r", "--name-only", "-z", "HEAD"])
        .stdout,
    ),
  );
  const indexPaths = nulSeparated(runGit(repositoryRoot, ["ls-files", "-z"]).stdout);
  if (indexPaths.some((file) => !headPaths.has(file))) {
    refuse("Pre-existing added or intent-to-add index entries are not allowed.");
  }
}

function validateSelectedFiles(repositoryRoot, files) {
  const normalized = files.map(normalizeSelectedPath);
  for (const file of normalized) {
    runGit(repositoryRoot, ["ls-files", "--error-unmatch", "--", file]);
    const headEntries = nulSeparated(
      runGit(repositoryRoot, ["ls-tree", "--name-only", "-z", "HEAD", "--", file])
        .stdout,
    );
    if (!samePathSet(headEntries, [file])) {
      refuse(`Use --new-file for a path that does not exist in HEAD: ${file}`);
    }
    const absolute = path.join(repositoryRoot, ...file.split("/"));
    let metadata;
    try {
      metadata = lstatSync(absolute);
    } catch {
      refuse(`Tracked deletions require a separately reviewed commit: ${file}`);
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      refuse(`Only tracked regular files may be checkpointed: ${file}`);
    }
    const changed = runGit(repositoryRoot, ["diff", "--quiet", "--", file], [0, 1]);
    if (changed.status !== 1) refuse(`Selected tracked file is unchanged: ${file}`);
  }
  return normalized;
}

function validateNewFiles(repositoryRoot, files) {
  const normalized = files.map(normalizeSelectedPath);
  for (const file of normalized) {
    const ignored = runUserConfigGit(
      repositoryRoot,
      ["check-ignore", "--quiet", "--no-index", "--", file],
      [0, 1],
    );
    if (ignored.status === 0) {
      refuse(`Explicit new file is ignored by effective Git configuration: ${file}`);
    }
    const tracked = runGit(
      repositoryRoot,
      ["ls-files", "--error-unmatch", "--", file],
      [0, 1],
    );
    if (tracked.status === 0) {
      refuse(`Use the tracked file list for an existing path: ${file}`);
    }
    const absolute = path.join(repositoryRoot, ...file.split("/"));
    let metadata;
    try {
      metadata = lstatSync(absolute);
    } catch {
      refuse(`Explicit new file does not exist: ${file}`);
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      refuse(`Only new regular files may be checkpointed: ${file}`);
    }
    const untracked = nulSeparated(
      runGit(repositoryRoot, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        file,
      ]).stdout,
    );
    if (!samePathSet(untracked, [file])) {
      refuse(`Explicit new file is ignored or does not resolve exactly: ${file}`);
    }
  }
  return normalized;
}

function workingBlobHashes(repositoryRoot, files) {
  return new Map(
    files.map((file) => [
      file,
      runGit(repositoryRoot, ["hash-object", `--path=${file}`, "--", file]).stdout.trim(),
    ]),
  );
}

function postCommitFailure(revision, cause) {
  const error = new Error(
    cause instanceof Error ? cause.message : "Post-commit verification failed.",
  );
  error.code = "ERR_CHECKPOINT_POSTCOMMIT";
  error.revision = revision;
  return error;
}

function createCheckpoint({
  repositoryRoot,
  identity,
  message,
  files,
  newFiles,
  afterCommit,
}) {
  const originalHead = runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]).stdout.trim();
  const selectedFiles = [...files, ...newFiles];
  const expectedHashes = workingBlobHashes(repositoryRoot, selectedFiles);
  const hooksDirectory = mkdtempSync(path.join(tmpdir(), "moneybags-empty-hooks-"));
  let commitCreated = false;
  let newHead = "unknown";
  try {
    if (newFiles.length > 0) {
      runGit(repositoryRoot, ["add", "--", ...newFiles]);
    }
    let committed;
    try {
      if (newFiles.length > 0) {
        runGit(repositoryRoot, [
          "diff",
          "--cached",
          "--check",
          "--",
          ...newFiles,
        ]);
      }
      const literalPaths = selectedFiles.map((file) => `:(literal)${file}`);
      committed = runGit(
        repositoryRoot,
        [
          "-c",
          `core.hooksPath=${hooksDirectory}`,
          "commit",
          "--only",
          "--no-gpg-sign",
          "--message",
          message,
          "--",
          ...literalPaths,
        ],
        [0],
        {
          GIT_AUTHOR_EMAIL: identity.email,
          GIT_AUTHOR_NAME: identity.name,
          GIT_COMMITTER_EMAIL: identity.email,
          GIT_COMMITTER_NAME: identity.name,
        },
      );
      commitCreated = true;
    } catch (error) {
      const observedHead = runGit(
        repositoryRoot,
        ["rev-parse", "--verify", "HEAD"],
      ).stdout.trim();
      if (observedHead !== originalHead) {
        throw postCommitFailure(observedHead, error);
      }
      if (newFiles.length > 0) {
        runGit(repositoryRoot, ["reset", "--quiet", "HEAD", "--", ...newFiles]);
      }
      throw error;
    }
    if (committed.stdout) process.stdout.write(committed.stdout);
    if (committed.stderr) process.stderr.write(committed.stderr);
  } finally {
    rmSync(hooksDirectory, { recursive: true, force: true });
  }

  try {
    newHead = runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]).stdout.trim();
    if (newHead === originalHead) refuse("Checkpoint did not advance HEAD.");
    afterCommit?.({ newHead, repositoryRoot });
    const parent = runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD^"]).stdout.trim();
    if (parent !== originalHead) refuse("Checkpoint did not advance from the verified HEAD.");
    const committedPaths = nulSeparated(
      runGit(repositoryRoot, [
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        "-z",
        "HEAD",
      ]).stdout,
    );
    if (!samePathSet(committedPaths, selectedFiles)) {
      refuse("Checkpoint committed an unexpected path set.");
    }
    for (const file of selectedFiles) {
      const committedHash = runGit(repositoryRoot, [
        "rev-parse",
        "--verify",
        `HEAD:${file}`,
      ]).stdout.trim();
      if (committedHash !== expectedHashes.get(file)) {
        refuse(`Checkpoint bytes changed during commit: ${file}`);
      }
    }
    const staged = runGit(repositoryRoot, ["diff", "--cached", "--quiet"], [0, 1]);
    if (staged.status !== 0) refuse("Checkpoint left staged changes behind.");
  } catch (error) {
    if (commitCreated) throw postCommitFailure(newHead, error);
    throw error;
  }

  const shortHead = runGit(repositoryRoot, ["rev-parse", "--short=7", "HEAD"]).stdout.trim();
  const status = runGit(repositoryRoot, ["status", "--short", "--branch"]).stdout;
  console.log(`checkpoint: COMMITTED ${shortHead}`);
  if (status) process.stdout.write(status);
}

export function main(arguments_ = process.argv.slice(2), options = {}) {
  try {
    const parsed = parseArguments(arguments_);
    const { repositoryRoot, gitDirectory, identity } = repositoryPreflight(
      options.repositoryRoot,
    );
    validateRepositoryState(repositoryRoot, gitDirectory);
    const files = validateSelectedFiles(repositoryRoot, parsed.files);
    const newFiles = validateNewFiles(repositoryRoot, parsed.newFiles);
    if (files.length > 0) {
      runGit(repositoryRoot, ["diff", "--check", "--", ...files]);
    }
    createCheckpoint({
      repositoryRoot,
      identity,
      message: parsed.message,
      files,
      newFiles,
      afterCommit: options.afterCommit,
    });
    return 0;
  } catch (error) {
    if (error instanceof Error && error.code === "ERR_CHECKPOINT_POSTCOMMIT") {
      console.error(
        `checkpoint: COMMITTED_WITH_VERIFICATION_FAILURE ${String(error.revision)} ${error.message} Do not retry; inspect HEAD.`,
      );
      return 3;
    }
    const message =
      error instanceof Error && error.code === "ERR_CHECKPOINT_REFUSED"
        ? error.message
        : "Unexpected checkpoint failure.";
    console.error(`checkpoint: REFUSED ${message}`);
    return 2;
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  process.exitCode = main();
}
