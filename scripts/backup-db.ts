import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  BackupProtocolError,
  createValidatedBackup,
} from "../src/db/backup-publication";
import { preflightDatabaseOpen } from "../src/db/preflight";

interface BackupCliDependencies {
  readonly preflight?: typeof preflightDatabaseOpen;
  readonly createBackup?: typeof createValidatedBackup;
  readonly log?: (message: string) => void;
  readonly logError?: (message: string) => void;
}

function parseKeep(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new BackupProtocolError(
      "preflight",
      "no-artifact",
      "Backup retention must be a positive integer.",
    );
  }
  const keep = Number(value);
  if (!Number.isSafeInteger(keep) || keep > 10_000) {
    throw new BackupProtocolError(
      "preflight",
      "no-artifact",
      "Backup retention must be at most 10000.",
    );
  }
  return keep;
}

function quoteTerminalValue(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u206f]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function failureDetails(error: unknown): {
  readonly stage: string;
  readonly outcome: string;
} {
  return error instanceof BackupProtocolError
    ? { stage: error.stage, outcome: error.outcome }
    : { stage: "preflight", outcome: "no-artifact" };
}

export async function main(
  arguments_: readonly string[] = process.argv.slice(2),
  dependencies: BackupCliDependencies = {},
): Promise<number> {
  try {
    const parsed = parseArgs({
      args: [...arguments_],
      options: { keep: { type: "string" } },
      allowPositionals: false,
      strict: true,
    });
    const keep = parseKeep(parsed.values.keep);
    const preflight = (dependencies.preflight ?? preflightDatabaseOpen)();
    const result = await (dependencies.createBackup ?? createValidatedBackup)({
      preflight,
      keep,
    });
    const log = dependencies.log ?? console.log;
    log("Backup publication: VALID");
    log(
      `Destination: ${quoteTerminalValue(
        path.join(result.backupDirectory, result.filename),
      )}`,
    );
    log(`Schema revision: ${result.revision.kind} ${result.revision.tag}`);
    log(`Retention pruned: ${result.pruned}`);
    log(
      result.durability === "confirmed"
        ? "Durability: confirmed"
        : "Durability: platform-best-effort (Windows directory fsync unavailable)",
    );
    log(
      result.filesystemPrivacy === "posix-modes-enforced"
        ? "Filesystem privacy: POSIX modes enforced"
        : "Filesystem privacy: unverified (Windows ACLs not enforced)",
    );
    return 0;
  } catch (error) {
    const failure = failureDetails(error);
    const logError = dependencies.logError ?? console.error;
    logError("Backup publication: FAILED");
    logError(`Stage: ${failure.stage}`);
    logError(`Artifact state: ${failure.outcome}`);
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().then((status) => {
    process.exitCode = status;
  });
}
