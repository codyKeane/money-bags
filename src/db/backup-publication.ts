import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  type BigIntStats,
} from "node:fs";
import path from "node:path";
import {
  BackupLogicalValidationError,
  BackupOperationalValidationError,
  createBackupValidationOracle,
  type BackupSchemaRevision,
  type BackupValidationOracle,
} from "./backup-validation";
import {
  BackupVerificationInputError,
  assertNoBackupSidecars,
  inspectBackupFile,
  sameBackupFileIdentity,
  validateBackupImageFile,
  type BackupFileIdentity,
} from "./backup-verifier";
import type { DatabaseOpenPreflight } from "./preflight";
import { enforcePrivateProcessUmask } from "./private-process";
import {
  backupDirectoryForDatabase,
  backupRootForDatabase,
} from "./backup-location";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const BACKUP_FINAL_NAME_PATTERN =
  /^moneybags-(\d{8}T\d{9}Z)-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.sqlite3$/;
const ONE_LINK = BigInt(1);
const TWO_LINKS = BigInt(2);
const POSIX_MODE_MASK = BigInt(0o7777);

export type BackupProtocolStage =
  | "preflight"
  | "directory"
  | "reserve"
  | "copy"
  | "validation"
  | "quarantine"
  | "file-sync"
  | "publication"
  | "directory-sync"
  | "staging-cleanup"
  | "retention";

export type BackupFailureOutcome =
  | "no-artifact"
  | "partial-retained"
  | "quarantined"
  | "quarantine-visible"
  | "published";

export class BackupProtocolError extends Error {
  readonly code = "ERR_MONEYBAGS_BACKUP_PROTOCOL";

  constructor(
    readonly stage: BackupProtocolStage,
    readonly outcome: BackupFailureOutcome,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "BackupProtocolError";
  }
}

export type BackupProtocolPhase =
  | "directory-ready"
  | "partial-reserved"
  | "copy-complete"
  | "standalone-ready"
  | "validation-complete"
  | "file-synced"
  | "final-linked"
  | "first-directory-sync"
  | "partial-removed"
  | "publication-complete"
  | "retention-complete";

export interface CreateValidatedBackupOptions {
  readonly preflight: Readonly<DatabaseOpenPreflight>;
  readonly keep?: number;
  readonly now?: () => Date;
  readonly uuid?: () => string;
  readonly platform?: NodeJS.Platform;
  readonly oracle?: BackupValidationOracle;
  readonly onlineBackup?: (sourcePath: string, partialPath: string) => Promise<void>;
  readonly syncFile?: (descriptor: number) => void;
  readonly syncDirectory?: (directory: string, platform: NodeJS.Platform) => void;
  readonly publishLink?: (source: string, destination: string) => void;
  readonly removeFile?: (target: string) => void;
  readonly onPhase?: (phase: BackupProtocolPhase) => void;
  readonly beforeRetention?: () => Promise<void>;
}

export interface ValidatedBackupResult {
  readonly backupDirectory: string;
  readonly filename: string;
  readonly revision: BackupSchemaRevision;
  readonly pruned: number;
  readonly durability: "confirmed" | "platform-best-effort";
  readonly filesystemPrivacy: "posix-modes-enforced" | "acl-unverified";
}

interface OwnedFile {
  readonly descriptor: number;
  readonly identity: BackupFileIdentity;
}

class CompletedOnlineBackupCleanupError extends Error {
  readonly copyComplete = true;
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

function compactUtcStamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new BackupProtocolError(
      "preflight",
      "no-artifact",
      "Backup clock did not produce a valid instant.",
    );
  }
  return date.toISOString().replace(/[-:.]/g, "");
}

function requireKeep(keep: number | undefined): void {
  if (
    keep !== undefined &&
    (!Number.isSafeInteger(keep) || keep < 1 || keep > 10_000)
  ) {
    throw new BackupProtocolError(
      "preflight",
      "no-artifact",
      "Backup retention must be an integer between 1 and 10000.",
    );
  }
}

function requireSourceIdentity(
  sourcePath: string,
  platform: NodeJS.Platform,
): BackupFileIdentity {
  let stats: BigIntStats;
  try {
    stats = lstatSync(sourcePath, { bigint: true });
  } catch (error) {
    throw new BackupProtocolError(
      "preflight",
      "no-artifact",
      "Configured database source is missing or cannot be inspected.",
      { cause: error },
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new BackupProtocolError(
      "preflight",
      "no-artifact",
      "Configured database source must be a regular file, not a link.",
    );
  }
  if (platform !== "win32" && stats.nlink !== ONE_LINK) {
    throw new BackupProtocolError(
      "preflight",
      "no-artifact",
      "Configured database source must have exactly one filesystem link.",
    );
  }
  try {
    if (realpathSync(sourcePath) !== sourcePath) {
      throw new BackupProtocolError(
        "preflight",
        "no-artifact",
        "Configured database source must use its canonical path.",
      );
    }
  } catch (error) {
    if (error instanceof BackupProtocolError) throw error;
    throw new BackupProtocolError(
      "preflight",
      "no-artifact",
      "Configured database source cannot be canonicalized.",
      { cause: error },
    );
  }
  return identityOf(stats);
}

function requirePrivateSourceParent(
  sourcePath: string,
  platform: NodeJS.Platform,
): void {
  if (platform === "win32") return;
  const parent = path.dirname(sourcePath);
  try {
    const stats = lstatSync(parent, { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new BackupProtocolError(
        "preflight",
        "no-artifact",
        "Configured database parent must be a regular directory, not a link.",
      );
    }
    if (realpathSync(parent) !== parent) {
      throw new BackupProtocolError(
        "preflight",
        "no-artifact",
        "Configured database parent must use its canonical path.",
      );
    }
    if (Number(stats.mode & POSIX_MODE_MASK) !== 0o700) {
      throw new BackupProtocolError(
        "preflight",
        "no-artifact",
        "Configured database parent is not mode 0700; audit and remediate it explicitly before backing up.",
      );
    }
  } catch (error) {
    if (error instanceof BackupProtocolError) throw error;
    throw new BackupProtocolError(
      "preflight",
      "no-artifact",
      "Configured database parent cannot be inspected safely.",
      { cause: error },
    );
  }
}

function assertSourceIdentity(
  sourcePath: string,
  expected: BackupFileIdentity,
  platform: NodeJS.Platform,
): void {
  let actual: BackupFileIdentity;
  try {
    actual = requireSourceIdentity(sourcePath, platform);
  } catch (error) {
    throw new BackupProtocolError(
      "copy",
      "partial-retained",
      "Configured database source could not be reverified after online backup.",
      { cause: error },
    );
  }
  if (!sameBackupFileIdentity(actual, expected)) {
    throw new BackupProtocolError(
      "copy",
      "partial-retained",
      "Configured database source changed during online backup.",
    );
  }
}

function ensurePrivateBackupDirectory(
  directory: string,
  platform: NodeJS.Platform,
): void {
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) {
      throw new BackupProtocolError(
        "directory",
        "no-artifact",
        "Private backup directory could not be created.",
        { cause: error },
      );
    }
  }

  try {
    const stats = lstatSync(directory, { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new BackupProtocolError(
        "directory",
        "no-artifact",
        "Backup destination must be a regular directory, not a link.",
      );
    }
    if (realpathSync(directory) !== directory) {
      throw new BackupProtocolError(
        "directory",
        "no-artifact",
        "Backup destination must use its canonical path.",
      );
    }
    if (
      platform !== "win32" &&
      Number(stats.mode & POSIX_MODE_MASK) !== 0o700
    ) {
      throw new BackupProtocolError(
        "directory",
        "no-artifact",
        "Existing backup directory is not mode 0700; audit and remediate it explicitly.",
      );
    }
  } catch (error) {
    if (error instanceof BackupProtocolError) throw error;
    throw new BackupProtocolError(
      "directory",
      "no-artifact",
      "Backup destination could not be inspected safely.",
      { cause: error },
    );
  }
}

function reservePartial(partialPath: string): OwnedFile {
  let descriptor: number;
  try {
    descriptor = openSync(partialPath, "wx", 0o600);
  } catch (error) {
    throw new BackupProtocolError(
      "reserve",
      "no-artifact",
      "Exclusive backup staging reservation failed.",
      { cause: error },
    );
  }
  try {
    const stats = fstatSync(descriptor, { bigint: true });
    if (!stats.isFile() || stats.nlink !== ONE_LINK) {
      throw new Error("Reserved staging object is not a single-link regular file.");
    }
    return Object.freeze({ descriptor, identity: identityOf(stats) });
  } catch (error) {
    try {
      closeSync(descriptor);
    } catch {
      // Preserve the reservation failure as the primary diagnostic.
    }
    throw new BackupProtocolError(
      "reserve",
      "partial-retained",
      "Reserved backup staging object could not be proven safe.",
      { cause: error },
    );
  }
}

function assertOwnedPath(
  target: string,
  owned: OwnedFile,
  expectedLinks: bigint,
): void {
  const descriptorStats = fstatSync(owned.descriptor, { bigint: true });
  const pathStats = lstatSync(target, { bigint: true });
  const descriptorIdentity = identityOf(descriptorStats);
  const pathIdentity = identityOf(pathStats);
  if (
    !descriptorStats.isFile() ||
    !pathStats.isFile() ||
    pathStats.isSymbolicLink() ||
    descriptorStats.nlink !== expectedLinks ||
    pathStats.nlink !== expectedLinks ||
    !sameBackupFileIdentity(descriptorIdentity, owned.identity) ||
    !sameBackupFileIdentity(pathIdentity, owned.identity)
  ) {
    throw new BackupProtocolError(
      "publication",
      "partial-retained",
      "Owned backup staging identity changed unexpectedly.",
    );
  }
}

async function defaultOnlineBackup(
  sourcePath: string,
  partialPath: string,
): Promise<void> {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  let copyError: unknown;
  try {
    await source.backup(partialPath);
  } catch (error) {
    copyError = error;
  }
  try {
    source.close();
  } catch (closeError) {
    if (copyError !== undefined) {
      throw new AggregateError(
        [copyError, closeError],
        "Online backup failed and its source handle could not be closed.",
      );
    }
    throw new CompletedOnlineBackupCleanupError(
      "Online backup completed but its source handle could not be closed.",
      { cause: closeError },
    );
  }
  if (copyError !== undefined) throw copyError;
}

function defaultSyncDirectory(
  directory: string,
  platform: NodeJS.Platform,
): void {
  if (platform === "win32") return;
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function assertNoStagingSidecars(partialPath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"] as const) {
    try {
      lstatSync(`${partialPath}${suffix}`);
      throw new BackupProtocolError(
        "validation",
        "partial-retained",
        "Completed backup image is not standalone.",
      );
    } catch (error) {
      if (error instanceof BackupProtocolError) throw error;
      if (!isNodeError(error, "ENOENT")) {
        throw new BackupProtocolError(
          "validation",
          "partial-retained",
          "Backup staging sidecar state could not be inspected.",
          { cause: error },
        );
      }
    }
  }
}

// SQLite's online backup can preserve WAL journal mode in the destination
// header. Normalize the completed, UUID-owned image before read-only validation
// so validation cannot create sidecars and the published artifact is standalone.
function normalizeStandaloneJournal(
  partialPath: string,
  owned: OwnedFile,
): void {
  assertNoStagingSidecars(partialPath);
  let sqlite: Database.Database;
  try {
    sqlite = new Database(partialPath, { fileMustExist: true });
  } catch (error) {
    const sqliteCode =
      error instanceof Error && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    if (/^SQLITE_(CORRUPT|NOTADB|FORMAT|SCHEMA)(?:_|$)/.test(sqliteCode)) {
      throw new BackupLogicalValidationError(
        "Completed backup is not a valid SQLite image.",
        { cause: error },
      );
    }
    throw new BackupOperationalValidationError(
      "Completed backup could not be opened for standalone normalization.",
      { cause: error },
    );
  }
  try {
    assertOwnedPath(partialPath, owned, ONE_LINK);
    const journalMode = sqlite.pragma("journal_mode = DELETE", {
      simple: true,
    });
    if (journalMode !== "delete") {
      throw new BackupOperationalValidationError(
        "Completed backup could not be normalized as a standalone image.",
      );
    }
  } catch (error) {
    if (
      error instanceof BackupLogicalValidationError ||
      error instanceof BackupOperationalValidationError
    ) {
      throw error;
    }
    const sqliteCode =
      error instanceof Error && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    if (/^SQLITE_(CORRUPT|NOTADB|FORMAT|SCHEMA)(?:_|$)/.test(sqliteCode)) {
      throw new BackupLogicalValidationError(
        "Completed backup is not a valid SQLite image.",
        { cause: error },
      );
    }
    throw new BackupOperationalValidationError(
      "Completed backup could not be normalized safely.",
      { cause: error },
    );
  } finally {
    try {
      sqlite.close();
    } catch (error) {
      throw new BackupOperationalValidationError(
        "Completed backup normalization handle could not be closed.",
        { cause: error },
      );
    }
  }
  assertOwnedPath(partialPath, owned, ONE_LINK);
  assertNoStagingSidecars(partialPath);
}

function closeOwned(owned: OwnedFile): void {
  closeSync(owned.descriptor);
}

function removeIncompleteOwnedPartial(
  partialPath: string,
  owned: OwnedFile,
  removeFile: (target: string) => void,
  onDescriptorClosed: () => void,
): void {
  assertOwnedPath(partialPath, owned, ONE_LINK);
  try {
    closeOwned(owned);
  } finally {
    onDescriptorClosed();
  }
  const afterClose = lstatSync(partialPath, { bigint: true });
  if (
    !afterClose.isFile() ||
    afterClose.isSymbolicLink() ||
    !sameBackupFileIdentity(identityOf(afterClose), owned.identity)
  ) {
    throw new BackupProtocolError(
      "copy",
      "partial-retained",
      "Incomplete staging object changed before cleanup.",
    );
  }
  removeFile(partialPath);
}

function publishOwnedFile(
  partialPath: string,
  destinationPath: string,
  directory: string,
  owned: OwnedFile,
  platform: NodeJS.Platform,
  publishLink: (source: string, destination: string) => void,
  removeFile: (target: string) => void,
  syncDirectory: (directory: string, platform: NodeJS.Platform) => void,
  onPhase: ((phase: BackupProtocolPhase) => void) | undefined,
  onDescriptorClosed: () => void,
  linkedOutcome: "published" | "quarantine-visible",
): void {
  assertOwnedPath(partialPath, owned, ONE_LINK);
  publishLink(partialPath, destinationPath);
  assertOwnedPath(partialPath, owned, TWO_LINKS);
  const destination = lstatSync(destinationPath, { bigint: true });
  if (
    !destination.isFile() ||
    destination.isSymbolicLink() ||
    !sameBackupFileIdentity(identityOf(destination), owned.identity)
  ) {
    throw new BackupProtocolError(
      "publication",
      "partial-retained",
      "Published backup does not reference the owned staging inode.",
    );
  }
  notifyPhase(onPhase, "final-linked", "publication", linkedOutcome);
  syncDirectory(directory, platform);
  notifyPhase(onPhase, "first-directory-sync", "directory-sync", linkedOutcome);

  try {
    closeOwned(owned);
  } finally {
    onDescriptorClosed();
  }
  const partial = lstatSync(partialPath, { bigint: true });
  if (!sameBackupFileIdentity(identityOf(partial), owned.identity)) {
    throw new BackupProtocolError(
      "staging-cleanup",
      "published",
      "Backup staging identity changed before unlink.",
    );
  }
  removeFile(partialPath);
  notifyPhase(onPhase, "partial-removed", "staging-cleanup", linkedOutcome);
  syncDirectory(directory, platform);
}

interface RetentionCandidate {
  readonly name: string;
  readonly path: string;
  readonly identity: BackupFileIdentity;
}

function retentionCandidates(
  directory: string,
  oracle: BackupValidationOracle,
  platform: NodeJS.Platform,
): RetentionCandidate[] {
  const candidates: RetentionCandidate[] = [];
  for (const name of readdirSync(directory)) {
    if (!BACKUP_FINAL_NAME_PATTERN.test(name)) continue;
    const candidatePath = path.join(directory, name);
    try {
      assertNoBackupSidecars(candidatePath);
      const inspected = inspectBackupFile(candidatePath, platform);
      if (platform !== "win32" && inspected.mode !== 0o600) continue;
      const verified = validateBackupImageFile(candidatePath, oracle, platform);
      candidates.push({ name, path: candidatePath, identity: verified.identity });
    } catch (error) {
      if (
        error instanceof BackupLogicalValidationError ||
        error instanceof BackupVerificationInputError
      ) {
        continue;
      }
      throw error;
    }
  }
  return candidates.sort((left, right) => left.name.localeCompare(right.name));
}

function pruneValidatedBackups(
  directory: string,
  keep: number,
  oracle: BackupValidationOracle,
  platform: NodeJS.Platform,
  removeFile: (target: string) => void,
  syncDirectory: (directory: string, platform: NodeJS.Platform) => void,
): number {
  const candidates = retentionCandidates(directory, oracle, platform);
  const toRemove = candidates.slice(0, Math.max(0, candidates.length - keep));
  let removed = 0;
  let primaryError: unknown;
  try {
    for (const candidate of toRemove) {
      let actual: ReturnType<typeof inspectBackupFile>;
      try {
        actual = inspectBackupFile(candidate.path, platform);
      } catch (error) {
        if (isNodeError((error as Error).cause, "ENOENT")) continue;
        throw error;
      }
      if (!sameBackupFileIdentity(actual.identity, candidate.identity)) {
        throw new BackupProtocolError(
          "retention",
          "published",
          "Retention candidate changed before deletion.",
        );
      }
      try {
        removeFile(candidate.path);
        removed += 1;
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }
    }
  } catch (error) {
    primaryError = error;
  }

  let syncError: unknown;
  if (removed > 0) {
    try {
      syncDirectory(directory, platform);
    } catch (error) {
      syncError = error;
    }
  }
  if (primaryError !== undefined && syncError !== undefined) {
    throw new AggregateError(
      [primaryError, syncError],
      "Retention failed and completed deletions could not be synchronized.",
    );
  }
  if (primaryError !== undefined) throw primaryError;
  if (syncError !== undefined) throw syncError;
  return removed;
}

function wrapFailure(
  error: unknown,
  stage: BackupProtocolStage,
  outcome: BackupFailureOutcome,
): BackupProtocolError {
  return error instanceof BackupProtocolError
    ? error
    : new BackupProtocolError(stage, outcome, "Validated backup protocol failed.", {
        cause: error,
      });
}

function notifyPhase(
  onPhase: ((phase: BackupProtocolPhase) => void) | undefined,
  phase: BackupProtocolPhase,
  stage: BackupProtocolStage,
  outcome: BackupFailureOutcome,
): void {
  if (onPhase === undefined) return;
  try {
    onPhase(phase);
  } catch (error) {
    throw new BackupProtocolError(
      stage,
      outcome,
      `Backup phase observer failed after ${phase}.`,
      { cause: error },
    );
  }
}

function ownedPathExists(target: string, owned: OwnedFile): boolean {
  try {
    const stats = lstatSync(target, { bigint: true });
    return (
      stats.isFile() &&
      !stats.isSymbolicLink() &&
      sameBackupFileIdentity(identityOf(stats), owned.identity)
    );
  } catch {
    return false;
  }
}

/** Creates, validates, publishes, and optionally prunes a synthetic-safe backup. */
export async function createValidatedBackup(
  options: CreateValidatedBackupOptions,
): Promise<ValidatedBackupResult> {
  enforcePrivateProcessUmask();
  requireKeep(options.keep);
  const platform = options.platform ?? process.platform;
  const uuid = (options.uuid ?? randomUUID)();
  if (!UUID_PATTERN.test(uuid)) {
    throw new BackupProtocolError(
      "preflight",
      "no-artifact",
      "Backup UUID source returned an unsafe value.",
    );
  }
  const stamp = compactUtcStamp((options.now ?? (() => new Date()))());
  const sourcePath = options.preflight.databasePath;
  requirePrivateSourceParent(sourcePath, platform);
  const sourceIdentity = requireSourceIdentity(sourcePath, platform);
  const oracle =
    options.oracle ?? createBackupValidationOracle(options.preflight.migrationsFolder);
  const backupRoot = backupRootForDatabase(sourcePath);
  const directory = backupDirectoryForDatabase(sourcePath);
  const base = `moneybags-${stamp}`;
  const partialName = `${base}.${uuid}.partial`;
  const finalName = `${base}-${uuid}.sqlite3`;
  const invalidName = `${base}-${uuid}.invalid`;
  const partialPath = path.join(directory, partialName);
  const finalPath = path.join(directory, finalName);
  const invalidPath = path.join(directory, invalidName);
  const onlineBackup = options.onlineBackup ?? defaultOnlineBackup;
  const syncFile = options.syncFile ?? fsyncSync;
  const syncDirectory = options.syncDirectory ?? defaultSyncDirectory;
  const publishLink = options.publishLink ?? linkSync;
  const removeFile = options.removeFile ?? unlinkSync;

  for (const managedDirectory of [backupRoot, directory]) {
    ensurePrivateBackupDirectory(managedDirectory, platform);
    try {
      syncDirectory(path.dirname(managedDirectory), platform);
    } catch (error) {
      throw new BackupProtocolError(
        "directory-sync",
        "no-artifact",
        "Backup directory entry could not be synchronized.",
        { cause: error },
      );
    }
  }
  notifyPhase(options.onPhase, "directory-ready", "directory", "no-artifact");
  const owned = reservePartial(partialPath);
  let descriptorOpen = true;
  let copyComplete = false;

  try {
    notifyPhase(options.onPhase, "partial-reserved", "reserve", "partial-retained");
    try {
      await onlineBackup(sourcePath, partialPath);
      copyComplete = true;
    } catch (error) {
      if (error instanceof CompletedOnlineBackupCleanupError) {
        copyComplete = true;
        throw new BackupProtocolError(
          "copy",
          "partial-retained",
          "Online backup completed but source cleanup was indeterminate.",
          { cause: error },
        );
      }
      try {
        removeIncompleteOwnedPartial(partialPath, owned, removeFile, () => {
          descriptorOpen = false;
        });
      } catch (cleanupError) {
        throw new BackupProtocolError(
          "copy",
          "partial-retained",
          "Online backup failed and its owned partial could not be cleaned up safely.",
          { cause: new AggregateError([error, cleanupError]) },
        );
      }
      throw new BackupProtocolError(
        "copy",
        "no-artifact",
        "Online backup did not complete.",
        { cause: error },
      );
    }
    notifyPhase(options.onPhase, "copy-complete", "copy", "partial-retained");

    assertSourceIdentity(sourcePath, sourceIdentity, platform);
    assertOwnedPath(partialPath, owned, ONE_LINK);
    if (platform !== "win32") {
      try {
        fchmodSync(owned.descriptor, 0o600);
        assertOwnedPath(partialPath, owned, ONE_LINK);
        if (
          Number(
            fstatSync(owned.descriptor, { bigint: true }).mode & POSIX_MODE_MASK,
          ) !== 0o600
        ) {
          throw new Error("mode verification failed");
        }
      } catch (error) {
        throw new BackupProtocolError(
          "validation",
          "partial-retained",
          "Owned backup staging file could not be secured as mode 0600.",
          { cause: error },
        );
      }
    }
    let revision: BackupSchemaRevision;
    try {
      normalizeStandaloneJournal(partialPath, owned);
      notifyPhase(
        options.onPhase,
        "standalone-ready",
        "validation",
        "partial-retained",
      );
      revision = validateBackupImageFile(partialPath, oracle, platform).revision;
      notifyPhase(
        options.onPhase,
        "validation-complete",
        "validation",
        "partial-retained",
      );
    } catch (error) {
      if (!(error instanceof BackupLogicalValidationError)) {
        throw wrapFailure(error, "validation", "partial-retained");
      }
      try {
        syncFile(owned.descriptor);
        publishOwnedFile(
          partialPath,
          invalidPath,
          directory,
          owned,
          platform,
          publishLink,
          removeFile,
          syncDirectory,
          options.onPhase,
          () => {
            descriptorOpen = false;
          },
          "quarantine-visible",
        );
      } catch (quarantineError) {
        throw new BackupProtocolError(
          "quarantine",
          ownedPathExists(invalidPath, owned)
            ? "quarantine-visible"
            : "partial-retained",
          "Logically invalid backup could not be quarantined safely.",
          { cause: new AggregateError([error, quarantineError]) },
        );
      }
      throw new BackupProtocolError(
        "validation",
        "quarantined",
        "Complete backup failed logical validation and was quarantined.",
        { cause: error },
      );
    }

    try {
      syncFile(owned.descriptor);
    } catch (error) {
      throw new BackupProtocolError(
        "file-sync",
        "partial-retained",
        "Validated backup image could not be synchronized.",
        { cause: error },
      );
    }
    notifyPhase(options.onPhase, "file-synced", "file-sync", "partial-retained");
    try {
      publishOwnedFile(
        partialPath,
        finalPath,
        directory,
        owned,
        platform,
        publishLink,
        removeFile,
        syncDirectory,
        options.onPhase,
        () => {
          descriptorOpen = false;
        },
        "published",
      );
    } catch (error) {
      const finalExists = ownedPathExists(finalPath, owned);
      if (finalExists) {
        throw new BackupProtocolError(
          error instanceof BackupProtocolError ? error.stage : "directory-sync",
          "published",
          "Backup final is visible but publication did not complete durably.",
          { cause: error },
        );
      }
      throw wrapFailure(
        error,
        "publication",
        "partial-retained",
      );
    }
    notifyPhase(
      options.onPhase,
      "publication-complete",
      "publication",
      "published",
    );

    let pruned = 0;
    if (options.keep !== undefined) {
      try {
        await options.beforeRetention?.();
        pruned = pruneValidatedBackups(
          directory,
          options.keep,
          oracle,
          platform,
          removeFile,
          syncDirectory,
        );
      } catch (error) {
        throw wrapFailure(error, "retention", "published");
      }
    }
    notifyPhase(options.onPhase, "retention-complete", "retention", "published");
    return Object.freeze({
      backupDirectory: directory,
      filename: finalName,
      revision,
      pruned,
      durability: platform === "win32" ? "platform-best-effort" : "confirmed",
      filesystemPrivacy:
        platform === "win32" ? "acl-unverified" : "posix-modes-enforced",
    });
  } catch (error) {
    if (descriptorOpen) {
      try {
        closeOwned(owned);
      } catch (closeError) {
        throw new BackupProtocolError(
          copyComplete ? "validation" : "copy",
          copyComplete ? "partial-retained" : "no-artifact",
          "Backup failed and its staging descriptor could not be closed.",
          { cause: new AggregateError([error, closeError]) },
        );
      }
    }
    throw error;
  }
}
