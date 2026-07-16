import { createHash } from "node:crypto";
import path from "node:path";

const BACKUP_NAMESPACE_PREFIX = "target-";

export function backupRootForDatabase(databasePath: string): string {
  if (!path.isAbsolute(databasePath) || path.resolve(databasePath) !== databasePath) {
    throw new Error("Backup location requires an absolute normalized database path.");
  }
  return path.join(path.dirname(databasePath), "backups");
}

/**
 * Gives each canonical ledger target an isolated retention namespace. The hash
 * prevents two ledgers in one parent from pruning each other's valid backups.
 */
export function backupDirectoryForDatabase(databasePath: string): string {
  const digest = createHash("sha256").update(databasePath).digest("hex").slice(0, 24);
  return path.join(backupRootForDatabase(databasePath), `${BACKUP_NAMESPACE_PREFIX}${digest}`);
}
