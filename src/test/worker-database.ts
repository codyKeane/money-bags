import { randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const WORKER_DIRECTORY_PATTERN = /^worker-\d+-\d+-/;
const WORKER_MARKER_NAME = ".moneybags-vitest-worker";
const workerState = new WeakMap<object, { readonly token: string; cleaned: boolean }>();

export interface WorkerDatabaseTarget {
  readonly root: string;
  readonly directory: string;
  readonly databasePath: string;
  readonly markerPath: string;
}

function requireWorkerIdentifier(value: string | undefined, name: string): string {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a numeric Vitest identifier.`);
  }
  return value;
}

function requireCanonicalDirectory(directory: string): string {
  if (!path.isAbsolute(directory)) {
    throw new Error("Vitest temporary root must be absolute.");
  }
  const canonical = realpathSync(directory);
  if (canonical !== directory || !lstatSync(canonical).isDirectory()) {
    throw new Error("Vitest temporary root must be a canonical directory.");
  }
  return canonical;
}

export function createWorkerDatabaseTarget(
  root: string,
  poolId: string | undefined,
  workerId: string | undefined,
): Readonly<WorkerDatabaseTarget> {
  const canonicalRoot = requireCanonicalDirectory(root);
  const pool = requireWorkerIdentifier(poolId, "VITEST_POOL_ID");
  const worker = requireWorkerIdentifier(workerId, "VITEST_WORKER_ID");
  const directory = realpathSync(
    mkdtempSync(path.join(canonicalRoot, `worker-${pool}-${worker}-`)),
  );
  if (path.dirname(directory) !== canonicalRoot) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error("Vitest worker directory escaped its temporary root.");
  }
  try {
    const token = randomBytes(32).toString("hex");
    const target = Object.freeze({
      root: canonicalRoot,
      directory,
      databasePath: path.join(directory, "default.db"),
      markerPath: path.join(directory, WORKER_MARKER_NAME),
    });
    writeFileSync(target.markerPath, `${token}\n`, { flag: "wx", mode: 0o600 });
    workerState.set(target, { token, cleaned: false });
    return target;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function cleanupWorkerDatabaseTarget(
  target: Readonly<WorkerDatabaseTarget>,
): void {
  const state = workerState.get(target);
  if (!state) {
    throw new Error("Refusing to clean an unknown Vitest worker target.");
  }
  if (state.cleaned) return;
  const canonicalRoot = requireCanonicalDirectory(target.root);
  if (
    canonicalRoot !== target.root ||
    path.dirname(target.directory) !== canonicalRoot ||
    !WORKER_DIRECTORY_PATTERN.test(path.basename(target.directory)) ||
    path.dirname(target.databasePath) !== target.directory ||
    path.basename(target.databasePath) !== "default.db" ||
    target.markerPath !== path.join(target.directory, WORKER_MARKER_NAME)
  ) {
    throw new Error("Refusing to clean an invalid Vitest worker target.");
  }
  const directoryStats = lstatSync(target.directory);
  if (
    !directoryStats.isDirectory() ||
    directoryStats.isSymbolicLink() ||
    realpathSync(target.directory) !== target.directory
  ) {
    throw new Error("Refusing to clean a non-canonical Vitest worker directory.");
  }
  const markerStats = lstatSync(target.markerPath);
  if (
    !markerStats.isFile() ||
    markerStats.isSymbolicLink() ||
    readFileSync(target.markerPath, "utf8") !== `${state.token}\n`
  ) {
    throw new Error("Refusing to clean a Vitest worker with invalid ownership.");
  }

  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    rmSync(`${target.databasePath}${suffix}`, { force: true });
  }
  rmSync(target.directory, { recursive: true, force: true });
  state.cleaned = true;
}
