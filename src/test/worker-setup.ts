import { afterAll, inject } from "vitest";
import {
  cleanupWorkerDatabaseTarget,
  createWorkerDatabaseTarget,
} from "./worker-database";

const target = createWorkerDatabaseTarget(
  inject("moneybagsTemporaryDatabaseRoot"),
  process.env.VITEST_POOL_ID,
  process.env.VITEST_WORKER_ID,
);

// setupFiles run in the worker before the test module is imported. This must
// remain above every dynamic application import in this file.
process.env.DB_FILE_NAME = target.databasePath;

afterAll(async () => {
  let closeError: unknown;
  try {
    const { closeImplicitDb } = await import("../db/client");
    closeImplicitDb();
  } catch (error) {
    closeError = error;
  }

  try {
    cleanupWorkerDatabaseTarget(target);
  } catch (cleanupError) {
    if (closeError !== undefined) {
      throw new AggregateError(
        [closeError, cleanupError],
        "Vitest worker database close and cleanup both failed.",
      );
    }
    throw cleanupError;
  }
  if (closeError !== undefined) throw closeError;
});
