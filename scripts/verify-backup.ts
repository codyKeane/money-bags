import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  BackupLogicalValidationError,
  BackupOperationalValidationError,
  createBackupValidationOracle,
} from "../src/db/backup-validation";
import {
  BackupVerificationInputError,
  verifyStandaloneBackup,
} from "../src/db/backup-verifier";
import { preflightDatabaseOpen } from "../src/db/preflight";

interface VerifyBackupCliDependencies {
  readonly preflight?: typeof preflightDatabaseOpen;
  readonly createOracle?: typeof createBackupValidationOracle;
  readonly verify?: typeof verifyStandaloneBackup;
  readonly log?: (message: string) => void;
  readonly logError?: (message: string) => void;
}

function failureKind(error: unknown): "input" | "logical" | "operational" {
  if (error instanceof BackupVerificationInputError) return "input";
  if (error instanceof BackupLogicalValidationError) return "logical";
  if (error instanceof BackupOperationalValidationError) return "operational";
  return "operational";
}

export function main(
  arguments_: readonly string[] = process.argv.slice(2),
  dependencies: VerifyBackupCliDependencies = {},
): number {
  try {
    const parsed = parseArgs({
      args: [...arguments_],
      allowPositionals: true,
      strict: true,
    });
    if (parsed.positionals.length !== 1) {
      throw new BackupVerificationInputError(
        "Exactly one explicit standalone backup path is required.",
      );
    }

    const preflight = (dependencies.preflight ?? preflightDatabaseOpen)();
    const result = (dependencies.verify ?? verifyStandaloneBackup)({
      candidatePath: parsed.positionals[0] ?? "",
      liveDatabasePath: preflight.databasePath,
      oracle: (dependencies.createOracle ?? createBackupValidationOracle)(
        preflight.migrationsFolder,
      ),
    });
    const log = dependencies.log ?? console.log;
    log("Backup verification: VALID");
    log(`Schema revision: ${result.revision.kind} ${result.revision.tag}`);
    return 0;
  } catch (error) {
    (dependencies.logError ?? console.error)(
      `Backup verification: INVALID (${failureKind(error)})`,
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
