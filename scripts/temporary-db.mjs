import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export const TEMP_DB_ROOT_ENV_NAME = "MONEYBAGS_TEMP_DB_ROOT";
export const TEMP_DB_TOKEN_ENV_NAME = "MONEYBAGS_TEMP_DB_TOKEN";
export const REPOSITORY_ROOT_ENV_NAME = "MONEYBAGS_REPOSITORY_ROOT";
export const TEMP_DB_MARKER_NAME = ".moneybags-temporary-database";
export const TEMP_DB_FILE_NAME = "database.sqlite";

const MARKER_VERSION = "moneybags-temporary-database-v1";
const ROOT_PREFIX = "moneybags-db-";
const leaseState = new WeakMap();

/**
 * @typedef {object} TemporaryDatabaseLease
 * @property {string} repositoryRoot
 * @property {string} rootPath
 * @property {string} databasePath
 * @property {string} markerPath
 * @property {string} ownershipToken
 */

function canonicalizePath(pathname) {
  let cursor = path.resolve(pathname);
  const missingSegments = [];

  for (;;) {
    try {
      const existing = realpathSync.native(cursor);
      return path.resolve(existing, ...missingSegments.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missingSegments.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function isWithin(candidate, tree) {
  const relative = path.relative(tree, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function markerToken(markerPath) {
  const stat = lstatSync(markerPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Temporary database ownership marker is invalid.");
  }

  const contents = readFileSync(markerPath, "utf8");
  const match = contents.match(/^moneybags-temporary-database-v1\n([a-f0-9]{64})\n$/);
  if (!match) throw new Error("Temporary database ownership marker is invalid.");
  return match[1];
}

function canonicalTemporaryDirectory(temporaryDirectory) {
  return realpathSync.native(path.resolve(temporaryDirectory));
}

/**
 * Validate that a directory is a wrapper-owned, canonical direct child of the
 * configured OS temporary directory. This reads only the ownership marker.
 */
/**
 * @param {string} rootPath
 * @param {{temporaryDirectory?: string, ownershipToken?: string, repositoryRoot?: string}} [options]
 */
export function validateTemporaryDatabaseRoot(
  rootPath,
  {
    temporaryDirectory = os.tmpdir(),
    ownershipToken,
    repositoryRoot,
  } = {},
) {
  if (typeof rootPath !== "string" || !path.isAbsolute(rootPath)) {
    throw new Error("Temporary database root must be an absolute path.");
  }

  const temporaryRoot = canonicalTemporaryDirectory(temporaryDirectory);
  const requestedRoot = path.resolve(rootPath);
  const stat = lstatSync(requestedRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Temporary database root is not an owned directory.");
  }

  const canonicalRoot = realpathSync.native(requestedRoot);
  if (
    canonicalRoot !== requestedRoot ||
    path.dirname(canonicalRoot) !== temporaryRoot ||
    !path.basename(canonicalRoot).startsWith(ROOT_PREFIX)
  ) {
    throw new Error("Temporary database root is not a canonical direct child of the OS temporary directory.");
  }

  const markerPath = path.join(canonicalRoot, TEMP_DB_MARKER_NAME);
  const actualToken = markerToken(markerPath);
  if (ownershipToken !== undefined && actualToken !== ownershipToken) {
    throw new Error("Temporary database ownership token does not match its marker.");
  }
  if (repositoryRoot !== undefined) {
    const canonicalRepositoryRoot = realpathSync.native(path.resolve(repositoryRoot));
    if (isWithin(canonicalRoot, canonicalRepositoryRoot)) {
      throw new Error("Temporary database root is inside the repository.");
    }
  }
  return {
    rootPath: canonicalRoot,
    databasePath: path.join(canonicalRoot, TEMP_DB_FILE_NAME),
    markerPath,
  };
}

function configuredRuntimeTree(repositoryRoot, inheritedDatabaseFileName) {
  if (!inheritedDatabaseFileName || !path.isAbsolute(inheritedDatabaseFileName)) {
    return canonicalizePath(path.join(repositoryRoot, "data"));
  }
  return canonicalizePath(path.dirname(path.normalize(inheritedDatabaseFileName)));
}

/**
 * Create an isolated temporary database lease without opening any database.
 * @returns {TemporaryDatabaseLease}
 */
export function createTemporaryDatabaseLease({
  repositoryRoot = path.resolve(import.meta.dirname, ".."),
  inheritedDatabaseFileName = process.env.DB_FILE_NAME,
  temporaryDirectory = os.tmpdir(),
  markerWriter = writeFileSync,
} = {}) {
  const canonicalRepositoryRoot = realpathSync.native(path.resolve(repositoryRoot));
  const temporaryRoot = canonicalTemporaryDirectory(temporaryDirectory);
  const rootPath = mkdtempSync(path.join(temporaryRoot, ROOT_PREFIX));
  const markerPath = path.join(rootPath, TEMP_DB_MARKER_NAME);
  let lease;

  try {
    const token = randomBytes(32).toString("hex");
    markerWriter(markerPath, `${MARKER_VERSION}\n${token}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    lease = {
      repositoryRoot: canonicalRepositoryRoot,
      rootPath,
      databasePath: path.join(rootPath, TEMP_DB_FILE_NAME),
      markerPath,
      ownershipToken: token,
    };
    Object.defineProperties(lease, {
      repositoryRoot: { enumerable: false },
      ownershipToken: { enumerable: false },
    });
    leaseState.set(lease, { token, temporaryDirectory: temporaryRoot, cleaned: false });
    validateTemporaryDatabaseRoot(rootPath, { temporaryDirectory: temporaryRoot });
    const runtimeTree = configuredRuntimeTree(
      canonicalRepositoryRoot,
      inheritedDatabaseFileName,
    );
    if (
      isWithin(lease.databasePath, canonicalRepositoryRoot) ||
      isWithin(lease.databasePath, runtimeTree)
    ) {
      throw new Error("Refusing a temporary database target inside a protected runtime tree.");
    }
    return lease;
  } catch (error) {
    try {
      if (lease === undefined) {
        rmSync(rootPath, { force: true, recursive: true });
      } else {
        cleanupTemporaryDatabaseLease(lease);
      }
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Temporary database setup and cleanup both failed.",
      );
    }
    throw error;
  }
}

export function listTemporaryDatabaseArtifacts(leaseOrRoot) {
  const rootPath =
    typeof leaseOrRoot === "string" ? leaseOrRoot : leaseOrRoot?.rootPath;
  const validated = validateTemporaryDatabaseRoot(rootPath);
  return readdirSync(validated.rootPath)
    .filter((entry) => entry !== TEMP_DB_MARKER_NAME)
    .sort();
}

/**
 * Clean a lease created by this process. Known SQLite files are removed first;
 * the marker and any other command artifacts disappear with the owned root.
 */
export function cleanupTemporaryDatabaseLease(lease) {
  const state = leaseState.get(lease);
  if (!state) throw new Error("Refusing to clean an unknown temporary database lease.");
  if (state.cleaned) return;

  try {
    const validated = validateTemporaryDatabaseRoot(lease.rootPath, {
      temporaryDirectory: state.temporaryDirectory,
    });
    if (markerToken(validated.markerPath) !== state.token) {
      throw new Error("Temporary database ownership marker changed before cleanup.");
    }

    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      rmSync(`${validated.databasePath}${suffix}`, { force: true, recursive: true });
    }
    rmSync(validated.rootPath, { force: true, recursive: true });
    state.cleaned = true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (!existsSync(lease.rootPath)) {
        state.cleaned = true;
        return;
      }
      throw new Error(
        "Temporary database root still exists but its ownership marker is missing.",
        { cause: error },
      );
    }
    throw error;
  }
}
