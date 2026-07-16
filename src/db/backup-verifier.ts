import Database from "better-sqlite3";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import path from "node:path";
import {
  BackupLogicalValidationError,
  BackupOperationalValidationError,
  type BackupSchemaRevision,
  type BackupValidationOracle,
} from "./backup-validation";

const ONE_LINK = BigInt(1);
const POSIX_MODE_MASK = BigInt(0o7777);

export interface BackupFileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

export interface VerifiedBackupImage {
  readonly identity: BackupFileIdentity;
  readonly revision: BackupSchemaRevision;
}

export interface VerifyStandaloneBackupOptions {
  readonly candidatePath: string;
  readonly liveDatabasePath: string;
  readonly oracle: BackupValidationOracle;
  readonly platform?: NodeJS.Platform;
}

export class BackupVerificationInputError extends Error {
  readonly code = "ERR_MONEYBAGS_BACKUP_INPUT";

  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "BackupVerificationInputError";
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function identityOf(stats: BigIntStats): BackupFileIdentity {
  return Object.freeze({ device: stats.dev, inode: stats.ino });
}

export function sameBackupFileIdentity(
  left: BackupFileIdentity,
  right: BackupFileIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

export function inspectBackupFile(
  candidatePath: string,
  platform: NodeJS.Platform = process.platform,
): Readonly<{ identity: BackupFileIdentity; mode: number }> {
  let stats: BigIntStats;
  try {
    stats = lstatSync(candidatePath, { bigint: true });
  } catch (error) {
    throw new BackupVerificationInputError(
      "Backup candidate is missing or cannot be inspected.",
      { cause: error },
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new BackupVerificationInputError(
      "Backup candidate must be a regular file, not a link.",
    );
  }
  if (platform !== "win32" && stats.nlink !== ONE_LINK) {
    throw new BackupVerificationInputError(
      "Backup candidate must have exactly one filesystem link.",
    );
  }
  let canonical: string;
  try {
    canonical = realpathSync(candidatePath);
  } catch (error) {
    throw new BackupVerificationInputError(
      "Backup candidate cannot be canonicalized.",
      { cause: error },
    );
  }
  if (canonical !== candidatePath) {
    throw new BackupVerificationInputError(
      "Backup candidate must use its canonical path.",
    );
  }
  return Object.freeze({
    identity: identityOf(stats),
    mode: Number(stats.mode & POSIX_MODE_MASK),
  });
}

function assertIdentity(
  candidatePath: string,
  expected: BackupFileIdentity,
  platform: NodeJS.Platform,
): void {
  const actual = inspectBackupFile(candidatePath, platform).identity;
  if (!sameBackupFileIdentity(actual, expected)) {
    throw new BackupOperationalValidationError(
      "Backup candidate changed while it was being validated.",
    );
  }
}

function assertStandaloneSQLiteHeader(
  candidatePath: string,
  expected: BackupFileIdentity,
  platform: NodeJS.Platform,
): void {
  const noFollow = platform === "win32" ? 0 : constants.O_NOFOLLOW;
  let descriptor: number;
  try {
    descriptor = openSync(candidatePath, constants.O_RDONLY | noFollow);
  } catch (error) {
    throw new BackupOperationalValidationError(
      "Backup candidate header could not be opened safely.",
      { cause: error },
    );
  }

  const header = Buffer.alloc(100);
  let bytesRead: number;
  try {
    const opened = identityOf(fstatSync(descriptor, { bigint: true }));
    if (!sameBackupFileIdentity(opened, expected)) {
      throw new BackupOperationalValidationError(
        "Backup candidate changed before its header was inspected.",
      );
    }
    bytesRead = readSync(descriptor, header, 0, header.length, 0);
  } catch (error) {
    if (error instanceof BackupOperationalValidationError) throw error;
    throw new BackupOperationalValidationError(
      "Backup candidate header could not be read.",
      { cause: error },
    );
  } finally {
    try {
      closeSync(descriptor);
    } catch (error) {
      throw new BackupOperationalValidationError(
        "Backup candidate header descriptor could not be closed.",
        { cause: error },
      );
    }
  }

  if (
    bytesRead !== header.length ||
    !header.subarray(0, 16).equals(Buffer.from("SQLite format 3\0", "binary"))
  ) {
    throw new BackupLogicalValidationError(
      "Backup candidate does not have a complete SQLite database header.",
    );
  }
  // SQLite header bytes 18/19 are the write/read versions. WAL mode is 2;
  // rollback-journal mode is 1. Reject WAL before SQLite can create SHM/WAL.
  if (header[18] !== 1 || header[19] !== 1) {
    throw new BackupLogicalValidationError(
      "Backup candidate is not a standalone rollback-journal image.",
    );
  }
}

/** Opens and validates an already-inspected standalone image without writing it. */
export function validateBackupImageFile(
  candidatePath: string,
  oracle: BackupValidationOracle,
  platform: NodeJS.Platform = process.platform,
): VerifiedBackupImage {
  const before = inspectBackupFile(candidatePath, platform).identity;
  assertStandaloneSQLiteHeader(candidatePath, before, platform);
  assertIdentity(candidatePath, before, platform);
  let sqlite: Database.Database;
  try {
    sqlite = new Database(candidatePath, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new BackupOperationalValidationError(
      "Backup candidate could not be opened read-only.",
      { cause: error },
    );
  }

  try {
    assertIdentity(candidatePath, before, platform);
    const revision = oracle.validate(sqlite);
    assertIdentity(candidatePath, before, platform);
    return Object.freeze({ identity: before, revision });
  } finally {
    try {
      sqlite.close();
    } catch (error) {
      throw new BackupOperationalValidationError(
        "Backup candidate validation handle could not be closed.",
        { cause: error },
      );
    }
  }
}

export function assertNoBackupSidecars(candidatePath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"] as const) {
    try {
      lstatSync(`${candidatePath}${suffix}`);
      throw new BackupVerificationInputError(
        "Backup candidate is not a standalone SQLite image.",
      );
    } catch (error) {
      if (error instanceof BackupVerificationInputError) throw error;
      if (!isNodeError(error, "ENOENT")) {
        throw new BackupVerificationInputError(
          "Backup sidecar state could not be inspected.",
          { cause: error },
        );
      }
    }
  }
}

function liveTargetIdentity(
  liveDatabasePath: string,
): BackupFileIdentity | undefined {
  try {
    const stats = lstatSync(liveDatabasePath, { bigint: true });
    return stats.isFile() && !stats.isSymbolicLink()
      ? identityOf(stats)
      : undefined;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw new BackupVerificationInputError(
      "Configured live target could not be compared safely.",
      { cause: error },
    );
  }
}

/**
 * Verifies an explicit offline image and rejects the configured live database,
 * its aliases, SQLite sidecars, and working/quarantine artifacts.
 */
export function verifyStandaloneBackup(
  options: VerifyStandaloneBackupOptions,
): VerifiedBackupImage {
  const platform = options.platform ?? process.platform;
  const candidatePath = options.candidatePath;
  if (
    !path.isAbsolute(candidatePath) ||
    path.resolve(candidatePath) !== candidatePath
  ) {
    throw new BackupVerificationInputError(
      "Backup candidate path must be explicit, absolute, and normalized.",
    );
  }
  const basename = path.basename(candidatePath);
  if (
    /\.(?:partial|invalid)$/i.test(basename) ||
    /-(?:wal|shm|journal)$/i.test(basename)
  ) {
    throw new BackupVerificationInputError(
      "Backup working, quarantine, and SQLite sidecar files cannot be restored.",
    );
  }
  if (candidatePath === options.liveDatabasePath) {
    throw new BackupVerificationInputError(
      "The configured live database cannot be verified as an offline backup.",
    );
  }

  assertNoBackupSidecars(candidatePath);
  const candidate = inspectBackupFile(candidatePath, platform);
  const liveIdentity = liveTargetIdentity(options.liveDatabasePath);
  if (
    liveIdentity !== undefined &&
    sameBackupFileIdentity(candidate.identity, liveIdentity)
  ) {
    throw new BackupVerificationInputError(
      "A filesystem alias of the live database is not an offline backup.",
    );
  }
  return validateBackupImageFile(candidatePath, options.oracle, platform);
}
