import {
  constants,
  accessSync,
  lstatSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  backupDirectoryForDatabase,
  backupRootForDatabase,
} from "../src/db/backup-location";
import { REPOSITORY_ROOT_ENV_NAME } from "../src/db/path";
import {
  preflightDatabaseOpen,
  type DatabaseOpenPreflight,
} from "../src/db/preflight";

type ServiceMode = "app" | "backup";

interface ServicePreflightDependencies {
  readonly platform?: NodeJS.Platform;
  readonly runtimeVersion?: string;
  readonly preflight?: () => Readonly<DatabaseOpenPreflight>;
  readonly lstatPath?: (target: string) => Stats;
  readonly realpathPath?: (target: string) => string;
  readonly accessPath?: (target: string, mode: number) => void;
  readonly readTextFile?: (target: string) => string;
  readonly workingDirectory?: string;
  readonly repositoryRootEnvironment?: string;
  readonly processEffectiveUserId?: () => number | undefined;
  readonly processUmask?: () => number;
  readonly processStatus?: string;
  readonly log?: (message: string) => void;
  readonly logError?: (message: string) => void;
}

const POSIX_MODE_MASK = 0o7777;
const MINIMUM_ENGINE_PATTERN = /^>=(\d+)\.(\d+)(?:\.(\d+))?$/;
const RUNTIME_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function parseVersion(
  value: string,
  pattern: RegExp,
  label: string,
): readonly [number, number, number] {
  const match = pattern.exec(value.trim());
  if (match === null) throw new Error(`${label} has an unsupported format.`);
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")];
}

function satisfiesMinimum(
  actual: readonly number[],
  minimum: readonly number[],
): boolean {
  for (let index = 0; index < 3; index += 1) {
    const actualPart = actual[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (actualPart > minimumPart) return true;
    if (actualPart < minimumPart) return false;
  }
  return true;
}

function isContainedBy(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function requireCanonicalArtifact(
  target: string,
  expectedType: "directory" | "file",
  lstatPath: (target: string) => Stats,
  realpathPath: (target: string) => string,
  missingMessage: string,
): Stats {
  let stats: Stats;
  try {
    stats = lstatPath(target);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) throw new Error(missingMessage, { cause: error });
    throw new Error("Required service path could not be inspected.", { cause: error });
  }
  const correctType =
    expectedType === "directory" ? stats.isDirectory() : stats.isFile();
  if (!correctType || stats.isSymbolicLink()) {
    throw new Error("Required service path must have its expected regular type, not a link.");
  }
  try {
    if (realpathPath(target) !== target) {
      throw new Error("Required service path must use its canonical path.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("canonical path")) throw error;
    throw new Error("Required service path could not be canonicalized.", { cause: error });
  }
  return stats;
}

function requireRuntimeVersion(
  repositoryRoot: string,
  runtimeVersion: string,
  readTextFile: (target: string) => string,
): void {
  let packageMetadata: unknown;
  try {
    packageMetadata = JSON.parse(readTextFile(path.join(repositoryRoot, "package.json")));
  } catch (error) {
    throw new Error("Runtime package metadata could not be read.", { cause: error });
  }
  const requirement =
    typeof packageMetadata === "object" &&
    packageMetadata !== null &&
    "engines" in packageMetadata &&
    typeof packageMetadata.engines === "object" &&
    packageMetadata.engines !== null &&
    "node" in packageMetadata.engines
      ? packageMetadata.engines.node
      : undefined;
  if (typeof requirement !== "string") {
    throw new Error("Runtime package metadata does not declare a Node engine.");
  }
  const minimum = parseVersion(
    requirement,
    MINIMUM_ENGINE_PATTERN,
    "The configured Node engine",
  );
  const actual = parseVersion(
    runtimeVersion,
    RUNTIME_VERSION_PATTERN,
    "The service Node version",
  );
  if (!satisfiesMinimum(actual, minimum)) {
    throw new Error(`The service Node executable does not satisfy ${requirement}.`);
  }
}

function requireServiceContext(
  repositoryRoot: string,
  platform: NodeJS.Platform,
  workingDirectory: string,
  repositoryRootEnvironment: string | undefined,
  processUmask: () => number,
  processStatus: string | undefined,
): void {
  if (workingDirectory !== repositoryRoot) {
    throw new Error("Service working directory must equal the configured repository root.");
  }
  if (repositoryRootEnvironment !== repositoryRoot) {
    throw new Error(
      `${REPOSITORY_ROOT_ENV_NAME} must equal the configured repository root.`,
    );
  }
  if (platform !== "win32" && processUmask() !== 0o077) {
    throw new Error("Service process must inherit exact umask 0077.");
  }
  if (platform === "linux") {
    let status = processStatus;
    if (status === undefined) {
      try {
        status = readFileSync("/proc/self/status", "utf8");
      } catch (error) {
        throw new Error("Service could not verify the Linux no-new-privileges state.", {
          cause: error,
        });
      }
    }
    if (!/^NoNewPrivs:\s+1$/mu.test(status)) {
      throw new Error("Service must run with Linux no-new-privileges enabled.");
    }
  }
}

function requireNonRootServiceIdentity(
  platform: NodeJS.Platform,
  processEffectiveUserId: () => number | undefined,
): void {
  if (platform === "win32") return;
  let effectiveUserId: number | undefined;
  try {
    effectiveUserId = processEffectiveUserId();
  } catch (error) {
    throw new Error("Service could not verify its effective user identity.", {
      cause: error,
    });
  }
  if (!Number.isSafeInteger(effectiveUserId) || (effectiveUserId ?? -1) < 0) {
    throw new Error("Service could not verify its effective user identity.");
  }
  if (effectiveUserId === 0) {
    throw new Error("Service must run with a non-root effective user identity.");
  }
}

function requireProductionBuild(
  repositoryRoot: string,
  lstatPath: (target: string) => Stats,
  realpathPath: (target: string) => string,
  accessPath: (target: string, mode: number) => void,
  readTextFile: (target: string) => string,
): void {
  const buildDirectory = path.join(repositoryRoot, ".next");
  const buildId = path.join(buildDirectory, "BUILD_ID");
  const serverFiles = path.join(buildDirectory, "required-server-files.json");
  const cacheDirectory = path.join(buildDirectory, "cache");
  requireCanonicalArtifact(
    buildDirectory,
    "directory",
    lstatPath,
    realpathPath,
    "Production build directory is missing; run the verified build before starting the service.",
  );
  const buildIdStats = requireCanonicalArtifact(
    buildId,
    "file",
    lstatPath,
    realpathPath,
    "Production build marker is missing; run the verified build before starting the service.",
  );
  if (buildIdStats.size < 1 || buildIdStats.size > 4_096) {
    throw new Error("Production build marker has an invalid size.");
  }
  let buildIdValue: string;
  try {
    buildIdValue = readTextFile(buildId);
  } catch (error) {
    throw new Error("Production build marker could not be read.", { cause: error });
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(buildIdValue)) {
    throw new Error("Production build marker has an invalid value.");
  }
  const serverFilesStats = requireCanonicalArtifact(
    serverFiles,
    "file",
    lstatPath,
    realpathPath,
    "Production server-files manifest is missing; run the verified build before starting the service.",
  );
  if (serverFilesStats.size < 2 || serverFilesStats.size > 5 * 1024 * 1024) {
    throw new Error("Production server-files manifest has an invalid size.");
  }
  let serverFilesMetadata: unknown;
  try {
    serverFilesMetadata = JSON.parse(readTextFile(serverFiles));
  } catch (error) {
    throw new Error("Production server-files manifest is not valid JSON.", {
      cause: error,
    });
  }
  if (
    typeof serverFilesMetadata !== "object" ||
    serverFilesMetadata === null ||
    Array.isArray(serverFilesMetadata)
  ) {
    throw new Error("Production server-files manifest has an invalid shape.");
  }
  const manifest = serverFilesMetadata as Record<string, unknown>;
  const manifestConfig = manifest.config;
  if (
    manifest.version !== 1 ||
    manifest.appDir !== repositoryRoot ||
    manifest.relativeAppDir !== "" ||
    typeof manifestConfig !== "object" ||
    manifestConfig === null ||
    Array.isArray(manifestConfig) ||
    (manifestConfig as Record<string, unknown>).distDir !== ".next" ||
    !Array.isArray(manifest.files) ||
    manifest.files.length < 2 ||
    manifest.files.length > 10_000
  ) {
    throw new Error("Production server-files manifest does not match this checkout.");
  }
  const requiredFiles = new Set<string>();
  for (const entry of manifest.files) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > 4_096 ||
      path.isAbsolute(entry) ||
      path.normalize(entry) !== entry
    ) {
      throw new Error("Production server-files manifest contains an unsafe path.");
    }
    const target = path.resolve(repositoryRoot, entry);
    if (!isContainedBy(buildDirectory, target) || requiredFiles.has(target)) {
      throw new Error("Production server-files manifest contains an unsafe path.");
    }
    requireCanonicalArtifact(
      target,
      "file",
      lstatPath,
      realpathPath,
      "Production server-files manifest references a missing file.",
    );
    try {
      accessPath(target, constants.R_OK);
    } catch (error) {
      throw new Error("Production server-files manifest references an unreadable file.", {
        cause: error,
      });
    }
    requiredFiles.add(target);
  }
  if (!requiredFiles.has(buildId) || !requiredFiles.has(serverFiles)) {
    throw new Error("Production server-files manifest omits a required build marker.");
  }
  requireCanonicalArtifact(
    cacheDirectory,
    "directory",
    lstatPath,
    realpathPath,
    "Production cache directory is missing; run the verified build before starting the service.",
  );
  try {
    accessPath(buildDirectory, constants.R_OK | constants.X_OK);
    accessPath(buildId, constants.R_OK);
    accessPath(serverFiles, constants.R_OK);
    accessPath(cacheDirectory, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch (error) {
    throw new Error("Production build and cache access is insufficient for the service user.", {
      cause: error,
    });
  }
}

function optionalCanonicalArtifact(
  target: string,
  expectedType: "directory" | "file",
  lstatPath: (target: string) => Stats,
  realpathPath: (target: string) => string,
): Stats | undefined {
  try {
    return requireCanonicalArtifact(
      target,
      expectedType,
      lstatPath,
      realpathPath,
      "Optional service path is missing.",
    );
  } catch (error) {
    if (error instanceof Error && isNodeError(error.cause, "ENOENT")) return undefined;
    throw error;
  }
}

function requirePrivateFile(
  target: string,
  label: string,
  accessMode: number,
  platform: NodeJS.Platform,
  lstatPath: (target: string) => Stats,
  realpathPath: (target: string) => string,
  accessPath: (target: string, mode: number) => void,
): boolean {
  const stats = optionalCanonicalArtifact(target, "file", lstatPath, realpathPath);
  if (stats === undefined) return false;
  if (platform !== "win32" && (stats.mode & POSIX_MODE_MASK) !== 0o600) {
    throw new Error(`${label} must be exact mode 0600; run the data-path audit for remediation.`);
  }
  try {
    accessPath(target, accessMode);
  } catch (error) {
    throw new Error(`${label} access is insufficient for this service.`, {
      cause: error,
    });
  }
  return true;
}

function requireDatabaseStorage(
  mode: ServiceMode,
  databasePath: string,
  platform: NodeJS.Platform,
  lstatPath: (target: string) => Stats,
  realpathPath: (target: string) => string,
  accessPath: (target: string, mode: number) => void,
): void {
  const parent = path.dirname(databasePath);
  const parentStats = requireCanonicalArtifact(
    parent,
    "directory",
    lstatPath,
    realpathPath,
    "Configured database parent is missing; create it privately before starting the service.",
  );
  if (platform !== "win32" && (parentStats.mode & POSIX_MODE_MASK) !== 0o700) {
    throw new Error(
      "Configured database parent must be exact mode 0700; run the data-path audit for remediation.",
    );
  }
  try {
    accessPath(parent, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch (error) {
    throw new Error("Configured database parent is not writable by the service user.", {
      cause: error,
    });
  }

  const databaseExists = requirePrivateFile(
    databasePath,
    "Configured database",
    mode === "app" ? constants.R_OK | constants.W_OK : constants.R_OK,
    platform,
    lstatPath,
    realpathPath,
    accessPath,
  );
  const existingSidecars = ["-wal", "-shm"].filter((suffix) =>
    requirePrivateFile(
      `${databasePath}${suffix}`,
      `Configured database ${suffix.slice(1).toUpperCase()} sidecar`,
      mode === "app" ? constants.R_OK | constants.W_OK : constants.R_OK,
      platform,
      lstatPath,
      realpathPath,
      accessPath,
    ),
  );
  if (!databaseExists) {
    if (existingSidecars.length > 0) {
      throw new Error("Configured database is missing while SQLite sidecars remain.");
    }
    if (mode === "backup") {
      throw new Error("Configured database is missing; backup service has no source.");
    }
  }
}

function requireBackupStorage(
  databasePath: string,
  platform: NodeJS.Platform,
  lstatPath: (target: string) => Stats,
  realpathPath: (target: string) => string,
  accessPath: (target: string, mode: number) => void,
): void {
  for (const [target, label] of [
    [backupRootForDatabase(databasePath), "Backup root"],
    [backupDirectoryForDatabase(databasePath), "Backup target namespace"],
  ] as const) {
    const stats = optionalCanonicalArtifact(target, "directory", lstatPath, realpathPath);
    if (stats === undefined) continue;
    if (platform !== "win32" && (stats.mode & POSIX_MODE_MASK) !== 0o700) {
      throw new Error(`${label} must be exact mode 0700; run the data-path audit for remediation.`);
    }
    try {
      accessPath(target, constants.R_OK | constants.W_OK | constants.X_OK);
    } catch (error) {
      throw new Error(`${label} is not writable by the service user.`, { cause: error });
    }
  }
}

/** Metadata-only service gate. Strict DB/migration preflight runs before path access. */
export function servicePreflight(
  mode: ServiceMode,
  dependencies: ServicePreflightDependencies = {},
): Readonly<DatabaseOpenPreflight> {
  const platform = dependencies.platform ?? process.platform;
  requireNonRootServiceIdentity(
    platform,
    dependencies.processEffectiveUserId ??
      (() => process.geteuid?.() ?? process.getuid?.()),
  );
  const preflight =
    dependencies.preflight ??
    (() => preflightDatabaseOpen());
  const configuration = preflight();
  const lstatPath = dependencies.lstatPath ?? lstatSync;
  const realpathPath = dependencies.realpathPath ?? realpathSync;
  const accessPath = dependencies.accessPath ?? accessSync;
  const readTextFile = dependencies.readTextFile ?? ((target) => readFileSync(target, "utf8"));
  requireServiceContext(
    configuration.repositoryRoot,
    platform,
    dependencies.workingDirectory ?? process.cwd(),
    dependencies.repositoryRootEnvironment ?? process.env[REPOSITORY_ROOT_ENV_NAME],
    dependencies.processUmask ?? (() => process.umask()),
    dependencies.processStatus,
  );
  requireRuntimeVersion(
    configuration.repositoryRoot,
    dependencies.runtimeVersion ?? process.version,
    readTextFile,
  );
  if (mode === "app") {
    requireProductionBuild(
      configuration.repositoryRoot,
      lstatPath,
      realpathPath,
      accessPath,
      readTextFile,
    );
  }
  requireDatabaseStorage(
    mode,
    configuration.databasePath,
    platform,
    lstatPath,
    realpathPath,
    accessPath,
  );
  if (mode === "backup") {
    requireBackupStorage(
      configuration.databasePath,
      platform,
      lstatPath,
      realpathPath,
      accessPath,
    );
  }
  return configuration;
}

export function main(
  arguments_: readonly string[] = process.argv.slice(2),
  dependencies: ServicePreflightDependencies = {},
): number {
  const mode = arguments_[0];
  if (arguments_.length !== 1 || (mode !== "app" && mode !== "backup")) {
    (dependencies.logError ?? console.error)(
      "Service preflight: FAILED reason=expected-app-or-backup-mode",
    );
    return 2;
  }
  try {
    servicePreflight(mode, dependencies);
    (dependencies.log ?? console.log)(`Service preflight: READY mode=${mode}`);
    return 0;
  } catch (error) {
    (dependencies.logError ?? console.error)(
      `Service preflight: FAILED mode=${mode} reason=${
        error instanceof Error ? error.message : "unknown failure"
      }`,
    );
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}
