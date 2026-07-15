import type { TestProject } from "vitest/node";
import {
  TEMP_DB_ROOT_ENV_NAME,
  TEMP_DB_TOKEN_ENV_NAME,
  cleanupTemporaryDatabaseLease,
  createTemporaryDatabaseLease,
  validateTemporaryDatabaseRoot,
} from "../../scripts/temporary-db.mjs";

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

export default function setup(project: TestProject): (() => void) | undefined {
  const wrapperOwnedRoot = process.env[TEMP_DB_ROOT_ENV_NAME];
  if (wrapperOwnedRoot !== undefined) {
    const wrapperOwnershipToken = process.env[TEMP_DB_TOKEN_ENV_NAME];
    if (wrapperOwnershipToken === undefined) {
      throw new Error("Temporary database wrapper ownership token is missing.");
    }
    const validated = validateTemporaryDatabaseRoot(wrapperOwnedRoot, {
      ownershipToken: wrapperOwnershipToken,
      repositoryRoot: project.config.root,
    });
    if (process.env.DB_FILE_NAME !== validated.databasePath) {
      throw new Error("Temporary database wrapper environment is inconsistent.");
    }
    project.provide("moneybagsTemporaryDatabaseRoot", validated.rootPath);
    return undefined;
  }

  // Direct Vitest invocations remain safe, although package scripts use the
  // outer wrapper so catchable-signal cleanup has a parent process owner.
  const inheritedRoot = process.env[TEMP_DB_ROOT_ENV_NAME];
  const inheritedToken = process.env[TEMP_DB_TOKEN_ENV_NAME];
  const inheritedDatabaseFileName = process.env.DB_FILE_NAME;
  const lease = createTemporaryDatabaseLease({
    repositoryRoot: project.config.root,
    inheritedDatabaseFileName,
  });
  try {
    process.env[TEMP_DB_ROOT_ENV_NAME] = lease.rootPath;
    process.env[TEMP_DB_TOKEN_ENV_NAME] = lease.ownershipToken;
    process.env.DB_FILE_NAME = lease.databasePath;
    project.provide("moneybagsTemporaryDatabaseRoot", lease.rootPath);
  } catch (error) {
    try {
      cleanupTemporaryDatabaseLease(lease);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Vitest global setup and cleanup both failed.",
      );
    } finally {
      restoreEnvironment(TEMP_DB_ROOT_ENV_NAME, inheritedRoot);
      restoreEnvironment(TEMP_DB_TOKEN_ENV_NAME, inheritedToken);
      restoreEnvironment("DB_FILE_NAME", inheritedDatabaseFileName);
    }
    throw error;
  }

  return () => {
    try {
      cleanupTemporaryDatabaseLease(lease);
    } finally {
      restoreEnvironment(TEMP_DB_ROOT_ENV_NAME, inheritedRoot);
      restoreEnvironment(TEMP_DB_TOKEN_ENV_NAME, inheritedToken);
      restoreEnvironment("DB_FILE_NAME", inheritedDatabaseFileName);
    }
  };
}
