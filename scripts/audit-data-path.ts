import { lstatSync, realpathSync, type Stats } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { devNull } from "node:os";
import { fileURLToPath } from "node:url";
import {
  preflightDatabaseOpen,
  type DatabaseOpenPreflight,
} from "../src/db/preflight";

type Environment = Record<string, string | undefined>;

export type DataPathClassification =
  | "repository-data"
  | "repository-unsafe"
  | "external";

export type GitIgnoreState =
  | "ignored"
  | "exposed"
  | "not-applicable"
  | "error";

export type ModeState = "mode" | "missing" | "unavailable" | "not-applicable";

export interface ModeAudit {
  readonly state: ModeState;
  readonly display: string;
}

export interface DataPathAuditReport {
  readonly status: "pass" | "fail";
  readonly repositoryRoot: string;
  readonly databasePath: string;
  readonly backupDirectory: string;
  readonly classification: DataPathClassification;
  readonly gitIgnore: GitIgnoreState;
  readonly parentMode: ModeAudit;
  readonly fileMode: ModeAudit;
  readonly remediation: readonly string[];
}

export interface GitCheckOptions {
  readonly cwd: string;
  readonly encoding: "utf8";
  readonly env: NodeJS.ProcessEnv;
  readonly input?: string;
  readonly maxBuffer: number;
  readonly shell: false;
  readonly stdio: ["pipe", "pipe", "ignore"];
  readonly timeout: number;
  readonly windowsHide: true;
}

export interface GitCheckResult {
  readonly status: number | null;
  readonly error?: Error;
  readonly stdout?: string;
}

export type SpawnGit = (
  command: string,
  arguments_: readonly string[],
  options: GitCheckOptions,
) => GitCheckResult;

type LstatPath = (target: string) => Stats;

export interface ResolvedAuditOptions {
  readonly platform?: NodeJS.Platform;
  readonly spawnGit?: SpawnGit;
  readonly lstatPath?: LstatPath;
}

export interface ConfiguredAuditOptions extends ResolvedAuditOptions {
  readonly environment?: Environment;
  readonly moduleDirectory?: string;
}

const GIT_CHECK_TIMEOUT_MS = 5_000;
const GIT_MAX_OUTPUT_BYTES = 64 * 1024;
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

function isContainedBy(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

/** Classifies a path already accepted and canonicalized by database preflight. */
export function classifyResolvedDatabasePath(
  repositoryRoot: string,
  databasePath: string,
): DataPathClassification {
  if (!isContainedBy(repositoryRoot, databasePath)) return "external";

  const dataRoot = path.join(repositoryRoot, "data");
  if (databasePath !== dataRoot && isContainedBy(dataRoot, databasePath)) {
    return "repository-data";
  }
  return "repository-unsafe";
}

function defaultSpawnGit(
  command: string,
  arguments_: readonly string[],
  options: GitCheckOptions,
): GitCheckResult {
  const result = spawnSync(command, [...arguments_], options);
  return {
    status: result.status,
    error: result.error,
    stdout: typeof result.stdout === "string" ? result.stdout : undefined,
  };
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^GIT_/i.test(key)) delete environment[key];
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = devNull;
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  return environment;
}

function gitOptions(repositoryRoot: string): GitCheckOptions {
  return {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: gitEnvironment(),
    maxBuffer: GIT_MAX_OUTPUT_BYTES,
    shell: false,
    stdio: ["pipe", "pipe", "ignore"],
    timeout: GIT_CHECK_TIMEOUT_MS,
    windowsHide: true,
  };
}

function successfulGitResult(result: GitCheckResult): boolean {
  return result.error === undefined && result.status === 0;
}

function removeFinalLineEnding(value: string): string {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n")) return value.slice(0, -1);
  return value;
}

function checkGitIgnore(
  preflight: Readonly<DatabaseOpenPreflight>,
  spawnGit: SpawnGit,
): GitIgnoreState {
  const options = gitOptions(preflight.repositoryRoot);
  const worktree = spawnGit(
    "git",
    ["rev-parse", "--path-format=absolute", "--show-toplevel"],
    options,
  );
  if (!successfulGitResult(worktree) || worktree.stdout === undefined) {
    return "error";
  }
  const reportedRoot = removeFinalLineEnding(worktree.stdout);
  if (reportedRoot.length === 0) return "error";
  let canonicalReportedRoot: string;
  try {
    canonicalReportedRoot = realpathSync(path.resolve(reportedRoot));
  } catch {
    return "error";
  }
  if (canonicalReportedRoot !== preflight.repositoryRoot) {
    return "error";
  }

  const relativeTarget = path
    .relative(preflight.repositoryRoot, preflight.databasePath)
    .split(path.sep)
    .join("/");
  const result = spawnGit(
    "git",
    ["check-ignore", "--verbose", "--stdin", "-z"],
    { ...options, input: `${relativeTarget}\0` },
  );
  if (result.error !== undefined || result.status === null) return "error";
  if (result.status === 1) return "exposed";
  if (result.status !== 0 || result.stdout === undefined) return "error";

  const [source, line, pattern, reportedTarget, trailing, ...extra] =
    result.stdout.split("\0");
  if (
    source !== ".gitignore" ||
    !/^\d+$/.test(line ?? "") ||
    pattern === undefined ||
    reportedTarget !== relativeTarget ||
    trailing !== "" ||
    extra.length !== 0
  ) {
    return "error";
  }
  return pattern.startsWith("!") ? "exposed" : "ignored";
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function inspectMode(target: string, lstatPath: LstatPath): ModeAudit {
  try {
    const mode = (lstatPath(target).mode & 0o7777).toString(8).padStart(4, "0");
    return Object.freeze({ state: "mode", display: mode });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return Object.freeze({ state: "missing", display: "missing" });
    }
    return Object.freeze({ state: "unavailable", display: "unavailable" });
  }
}

function inspectModes(
  databasePath: string,
  platform: NodeJS.Platform,
  lstatPath: LstatPath,
): Readonly<{ parentMode: ModeAudit; fileMode: ModeAudit }> {
  if (platform === "win32") {
    const notApplicable = Object.freeze({
      state: "not-applicable" as const,
      display: "n/a (Windows)",
    });
    return Object.freeze({ parentMode: notApplicable, fileMode: notApplicable });
  }
  return Object.freeze({
    parentMode: inspectMode(path.dirname(databasePath), lstatPath),
    fileMode: inspectMode(databasePath, lstatPath),
  });
}

/** Audits metadata only. It never opens the database file or creates a path. */
export function auditResolvedDataPath(
  preflight: Readonly<DatabaseOpenPreflight>,
  options: ResolvedAuditOptions = {},
): Readonly<DataPathAuditReport> {
  const classification = classifyResolvedDatabasePath(
    preflight.repositoryRoot,
    preflight.databasePath,
  );
  const gitIgnore =
    classification === "repository-data"
      ? checkGitIgnore(preflight, options.spawnGit ?? defaultSpawnGit)
      : "not-applicable";
  const { parentMode, fileMode } = inspectModes(
    preflight.databasePath,
    options.platform ?? process.platform,
    options.lstatPath ?? lstatSync,
  );

  const remediation: string[] = [];
  if (classification === "repository-unsafe") {
    remediation.push(
      "Set DB_FILE_NAME to a normalized path below data/ or to a canonical absolute path outside the repository.",
    );
  } else if (classification === "repository-data" && gitIgnore === "exposed") {
    remediation.push(
      "Keep runtime databases out of samples: ensure the whole data/ tree is ignored and place only fake fixtures below data/samples/.",
      "If this runtime target is already tracked, preserve the local ledger and remove only its path from Git tracking through the normal reviewed workflow; never delete the local file as remediation.",
    );
  } else if (classification === "repository-data" && gitIgnore === "error") {
    remediation.push(
      "Ensure Git resolves this exact checkout and the root .gitignore supplies the data-path rule, then rerun the audit.",
    );
  } else if (classification === "external") {
    remediation.push(
      "Keep this absolute target outside Git, secure its parent directory, and back up the reported sibling backups directory.",
    );
  } else {
    remediation.push(
      "No Git-boundary change is required; keep real data outside data/samples/ and back up the reported sibling backups directory.",
    );
  }

  if (parentMode.state === "unavailable" || fileMode.state === "unavailable") {
    remediation.push(
      "Fix filesystem access so parent and target metadata can be inspected, then rerun the audit.",
    );
  }

  const failed =
    classification === "repository-unsafe" ||
    gitIgnore === "exposed" ||
    gitIgnore === "error" ||
    parentMode.state === "unavailable" ||
    fileMode.state === "unavailable";

  return Object.freeze({
    status: failed ? "fail" : "pass",
    repositoryRoot: preflight.repositoryRoot,
    databasePath: preflight.databasePath,
    backupDirectory: path.join(path.dirname(preflight.databasePath), "backups"),
    classification,
    gitIgnore,
    parentMode,
    fileMode,
    remediation: Object.freeze(remediation),
  });
}

/** Runs shared env/path/migration preflight before producing any audit result. */
export function auditConfiguredDataPath(
  options: ConfiguredAuditOptions = {},
): Readonly<DataPathAuditReport> {
  const environment = { ...(options.environment ?? process.env) };
  const preflight = preflightDatabaseOpen({
    environment,
    moduleDirectory: options.moduleDirectory ?? MODULE_DIRECTORY,
  });
  return auditResolvedDataPath(preflight, options);
}

function quoteTerminalValue(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u206f]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function formatDataPathAudit(report: Readonly<DataPathAuditReport>): string {
  const gitIgnore =
    report.gitIgnore === "not-applicable" ? "n/a" : report.gitIgnore;
  return [
    `Data path audit: ${report.status.toUpperCase()}`,
    `Resolved target: ${quoteTerminalValue(report.databasePath)}`,
    `Repository root: ${quoteTerminalValue(report.repositoryRoot)}`,
    `Classification: ${report.classification}`,
    `Git ignored: ${gitIgnore}`,
    `Parent mode: ${report.parentMode.display}`,
    `File mode: ${report.fileMode.display}`,
    `Backup directory: ${quoteTerminalValue(report.backupDirectory)}`,
    ...report.remediation.map((item) => `Remediation: ${item}`),
  ].join("\n");
}

function formatPreflightFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown preflight failure.";
  return [
    "Data path audit: FAIL",
    `Preflight error: ${quoteTerminalValue(message)}`,
    "Remediation: Correct the environment, resolved database target, and reviewed migration assets, then rerun the audit.",
  ].join("\n");
}

export function main(): number {
  try {
    const report = auditConfiguredDataPath();
    console.log(formatDataPathAudit(report));
    return report.status === "pass" ? 0 : 1;
  } catch (error) {
    console.error(formatPreflightFailure(error));
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}
