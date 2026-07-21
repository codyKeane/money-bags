import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  restoreDatabase,
  type RestoreDatabaseOptions,
} from "../src/db/restore";
import { preflightDatabaseOpen } from "../src/db/preflight";

interface RestoreCliDependencies {
  readonly preflight?: typeof preflightDatabaseOpen;
  readonly restore?: typeof restoreDatabase;
  readonly log?: (message: string) => void;
  readonly logError?: (message: string) => void;
}

export async function main(
  arguments_: readonly string[] = process.argv.slice(2),
  dependencies: RestoreCliDependencies = {},
): Promise<number> {
  try {
    const parsed = parseArgs({
      args: [...arguments_],
      options: {
        backup: { type: "string" },
        target: { type: "string" },
        confirm: { type: "boolean", default: false },
        quiesced: { type: "boolean", default: false },
      },
      allowPositionals: false,
      strict: true,
    });
    const backupPath = parsed.values.backup;
    const targetPath = parsed.values.target;
    if (typeof backupPath !== "string" || typeof targetPath !== "string") {
      throw new Error("--backup and --target are required.");
    }
    if (parsed.values.confirm && !parsed.values.quiesced) {
      throw new Error("--confirm requires --quiesced; stop the application before restoring.");
    }
    const preflight = (dependencies.preflight ?? preflightDatabaseOpen)();
    const options: RestoreDatabaseOptions = {
      backupPath,
      targetPath,
      preflight,
      confirm: parsed.values.confirm,
      quiesced: parsed.values.quiesced,
    };
    const result = await (dependencies.restore ?? restoreDatabase)(options);
    const log = dependencies.log ?? console.log;
    if (result.status === "preview") {
      log("Restore preview: NO CHANGES MADE");
      log(`Backup: ${result.backupPath}`);
      log(`Target: ${result.targetPath}`);
      log(`Retained rescue path if confirmed: ${result.rescuePath}`);
      log(`Schema revision: ${result.revision.kind} ${result.revision.tag}`);
    } else {
      log("Restore: COMPLETE");
      log(`Target: ${result.targetPath}`);
      log(`Retained rescue copy: ${result.rescuePath}`);
      log(`Schema revision: ${result.revision.kind} ${result.revision.tag}`);
    }
    return 0;
  } catch (error) {
    (dependencies.logError ?? console.error)(
      `Restore: FAILED${error instanceof Error ? ` — ${error.message}` : ""}`,
    );
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
