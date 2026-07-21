import Database from "better-sqlite3";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  type BigIntStats,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  createBackupValidationOracle,
  type BackupSchemaRevision,
  type BackupValidationOracle,
} from "./backup-validation";
import { assertNoBackupSidecars,
  inspectBackupFile,
  validateBackupImageFile,
} from "./backup-verifier";
import type { DatabaseOpenPreflight } from "./preflight";

const POSIX_MODE_MASK = BigInt(0o7777);
const ONE_LINK = BigInt(1);

export class RestoreInputError extends Error {
  readonly code = "ERR_MONEYBAGS_RESTORE_INPUT";
}

export class RestoreOperationalError extends Error {
  readonly code = "ERR_MONEYBAGS_RESTORE_OPERATIONAL";
}

export interface RestoreDatabaseOptions {
  readonly backupPath: string;
  readonly targetPath: string;
  readonly preflight: Readonly<DatabaseOpenPreflight>;
  readonly confirm?: boolean;
  readonly quiesced?: boolean;
  readonly platform?: NodeJS.Platform;
  readonly oracle?: BackupValidationOracle;
  readonly uuid?: () => string;
  readonly now?: () => Date;
}

export interface RestorePreview {
  readonly status: "preview";
  readonly backupPath: string;
  readonly targetPath: string;
  readonly rescuePath: string;
  readonly revision: BackupSchemaRevision;
}

export interface RestoreResult extends Omit<RestorePreview, "status"> {
  readonly status: "restored";
  readonly rescueVerified: BackupSchemaRevision;
}

function isAbsoluteNormalized(value: string): boolean {
  return path.isAbsolute(value) && path.resolve(value) === value;
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function requireRegularCanonicalFile(file: string, label: string): BigIntStats {
  let stats: BigIntStats;
  try {
    stats = lstatSync(file, { bigint: true });
  } catch (error) {
    throw new RestoreInputError(`${label} is missing or cannot be inspected.`, { cause: error });
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== ONE_LINK) {
    throw new RestoreInputError(`${label} must be a single-link regular file.`);
  }
  try {
    if (realpathSync(file) !== file) {
      throw new RestoreInputError(`${label} must use its canonical path.`);
    }
  } catch (error) {
    if (error instanceof RestoreInputError) throw error;
    throw new RestoreInputError(`${label} cannot be canonicalized.`, { cause: error });
  }
  return stats;
}

function requirePrivateParent(file: string, platform: NodeJS.Platform): string {
  const parent = path.dirname(file);
  let stats: BigIntStats;
  try {
    stats = lstatSync(parent, { bigint: true });
  } catch (error) {
    throw new RestoreInputError("Restore target parent cannot be inspected.", { cause: error });
  }
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync(parent) !== parent) {
    throw new RestoreInputError("Restore target parent must be a canonical regular directory.");
  }
  if (platform !== "win32" && Number(stats.mode & POSIX_MODE_MASK) !== 0o700) {
    throw new RestoreInputError("Restore target parent must be mode 0700.");
  }
  return parent;
}

function requireUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new RestoreInputError("Restore UUID source returned an unsafe value.");
  }
}

function restoreStamp(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new RestoreInputError("Restore clock is invalid.");
  return now.toISOString().replace(/[-:.]/gu, "");
}

function syncFile(file: string, platform: NodeJS.Platform): void {
  if (platform === "win32") return;
  const descriptor = openSync(file, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function syncDirectory(directory: string, platform: NodeJS.Platform): void {
  if (platform === "win32") return;
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function assertNoTargetSidecars(targetPath: string): void {
  try {
    assertNoBackupSidecars(targetPath);
  } catch (error) {
    throw new RestoreInputError("The configured target has SQLite sidecars; stop it and reconcile them before restore.", { cause: error });
  }
}

async function captureRescue(
  targetPath: string,
  rescuePath: string,
  oracle: BackupValidationOracle,
  platform: NodeJS.Platform,
): Promise<BackupSchemaRevision> {
  let source: Database.Database | undefined;
  try {
    source = new Database(targetPath, { readonly: true, fileMustExist: true });
    await source.backup(rescuePath);
  } catch (error) {
    throw new RestoreOperationalError("Could not create the retained rescue copy of the live database.", { cause: error });
  } finally {
    try {
      source?.close();
    } catch (error) {
      throw new RestoreOperationalError("Could not close the live database rescue handle.", { cause: error });
    }
  }
  chmodSync(rescuePath, 0o600);
  let rescue: Database.Database | undefined;
  try {
    rescue = new Database(rescuePath, { fileMustExist: true });
    const mode = rescue.pragma("journal_mode = DELETE", { simple: true });
    if (mode !== "delete") throw new Error("rescue journal mode did not become DELETE");
  } catch (error) {
    throw new RestoreOperationalError("The rescue copy could not be normalized as a standalone image.", { cause: error });
  } finally {
    try {
      rescue?.close();
    } catch (error) {
      throw new RestoreOperationalError("Could not close the rescue validation handle.", { cause: error });
    }
  }
  syncFile(rescuePath, platform);
  assertNoBackupSidecars(rescuePath);
  return validateBackupImageFile(rescuePath, oracle, platform).revision;
}

function copyStage(sourcePath: string, stagePath: string, platform: NodeJS.Platform): void {
  try {
    copyFileSync(sourcePath, stagePath);
    chmodSync(stagePath, 0o600);
    syncFile(stagePath, platform);
    assertNoBackupSidecars(stagePath);
  } catch (error) {
    try {
      if (existsSync(stagePath)) unlinkSync(stagePath);
    } catch {
      // Preserve the copy failure; a visible stage is safer than pretending it is gone.
    }
    throw new RestoreOperationalError("The verified backup could not be staged beside the target.", { cause: error });
  }
}

function makeRescuePath(targetPath: string, stamp: string, uuid: string): string {
  return path.join(path.dirname(targetPath), `moneybags-restore-rescue-${stamp}-${uuid}.sqlite3`);
}

function validateInputs(
  options: RestoreDatabaseOptions,
): {
  platform: NodeJS.Platform;
  oracle: BackupValidationOracle;
  targetParent: string;
  rescuePath: string;
  revision: BackupSchemaRevision;
} {
  const platform = options.platform ?? process.platform;
  if (!isAbsoluteNormalized(options.backupPath) || !isAbsoluteNormalized(options.targetPath)) {
    throw new RestoreInputError("Backup and restore target paths must be absolute and normalized.");
  }
  if (options.targetPath !== options.preflight.databasePath) {
    throw new RestoreInputError("Restore target must exactly match the configured canonical database path.");
  }
  if (options.backupPath === options.targetPath) {
    throw new RestoreInputError("Backup path must not be the configured live database.");
  }
  requireRegularCanonicalFile(options.targetPath, "Configured restore target");
  const targetParent = requirePrivateParent(options.targetPath, platform);
  assertNoTargetSidecars(options.targetPath);
  const inspectedBackup = inspectBackupFile(options.backupPath, platform);
  if (platform !== "win32" && inspectedBackup.mode !== 0o600) {
    throw new RestoreInputError("Backup candidate must be mode 0600.");
  }
  assertNoBackupSidecars(options.backupPath);
  const oracle = options.oracle ?? createBackupValidationOracle(options.preflight.migrationsFolder);
  const verified = validateBackupImageFile(options.backupPath, oracle, platform);
  const uuid = (options.uuid ?? randomUUID)();
  requireUuid(uuid);
  const stamp = restoreStamp((options.now ?? (() => new Date()))());
  const rescuePath = makeRescuePath(options.targetPath, stamp, uuid);
  if (existsSync(rescuePath)) throw new RestoreInputError("The generated rescue path already exists.");
  return { platform, oracle, targetParent, rescuePath, revision: verified.revision };
}

export async function restoreDatabase(
  options: RestoreDatabaseOptions,
): Promise<RestorePreview | RestoreResult> {
  const validated = validateInputs(options);
  const preview: RestorePreview = {
    status: "preview",
    backupPath: options.backupPath,
    targetPath: options.targetPath,
    rescuePath: validated.rescuePath,
    revision: validated.revision,
  };
  if (options.confirm && !options.quiesced) {
    throw new RestoreInputError("--confirm requires a quiesced application; no restore was attempted.");
  }
  if (!options.confirm || !options.quiesced) return preview;

  const lockPath = `${options.targetPath}.restore.lock`;
  let lockDescriptor: number | undefined;
  try {
    lockDescriptor = openSync(lockPath, "wx", 0o600);
    syncFile(lockPath, validated.platform);
  } catch (error) {
    throw new RestoreOperationalError("Could not acquire the no-clobber restore lock.", { cause: error });
  }

  let stagePath: string | undefined;
  let rescueCreated = false;
  try {
    const rescueRevision = await captureRescue(
      options.targetPath,
      validated.rescuePath,
      validated.oracle,
      validated.platform,
    );
    rescueCreated = true;
    stagePath = path.join(validated.targetParent, `moneybags-restore-stage-${randomUUID()}.sqlite3`);
    copyStage(options.backupPath, stagePath, validated.platform);
    renameSync(stagePath, options.targetPath);
    stagePath = undefined;
    syncDirectory(validated.targetParent, validated.platform);
    assertNoTargetSidecars(options.targetPath);
    try {
      validateBackupImageFile(options.targetPath, validated.oracle, validated.platform);
    } catch (error) {
      const rollbackStage = path.join(validated.targetParent, `moneybags-restore-rollback-${randomUUID()}.sqlite3`);
      try {
        copyStage(validated.rescuePath, rollbackStage, validated.platform);
        renameSync(rollbackStage, options.targetPath);
        syncDirectory(validated.targetParent, validated.platform);
      } catch (rollbackError) {
        throw new RestoreOperationalError("Restore post-verification failed and automatic rollback also failed; retain the rescue copy and stop the application.", {
          cause: new AggregateError([error, rollbackError]),
        });
      }
      throw new RestoreOperationalError("Restore post-verification failed; the retained rescue copy was restored.", { cause: error });
    }
    syncFile(options.targetPath, validated.platform);
    return {
      ...preview,
      status: "restored",
      rescueVerified: rescueRevision,
    };
  } catch (error) {
    if (stagePath !== undefined && existsSync(stagePath) && !rescueCreated) {
      try {
        unlinkSync(stagePath);
      } catch {
        // Keep any visible stage for operator inspection if cleanup is uncertain.
      }
    }
    throw error;
  } finally {
    if (lockDescriptor !== undefined) closeSync(lockDescriptor);
    try {
      unlinkSync(lockPath);
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        // Lock cleanup failure is surfaced rather than claiming a clean handoff.
        throw new RestoreOperationalError("Restore completed but its no-clobber lock could not be removed.", { cause: error });
      }
    }
  }
}
