import { drizzle } from "drizzle-orm/better-sqlite3";
import { preflightDatabaseOpen } from "./preflight";
import { seedDemoData } from "./seed-data";
import { DemoSeedRefusal, openExistingDemoSeedTarget } from "./seed-target";
import * as schema from "./schema";

function printFailure(error: unknown): void {
  if (error instanceof DemoSeedRefusal) {
    console.error(error.message);
  } else {
    console.error(
      "Demo seed preflight or initialization failed. Verify .env, DB_FILE_NAME, and the reviewed migration assets before retrying against a disposable target.",
    );
  }
}

function main(): void {
  if (process.argv.length > 2) {
    throw new DemoSeedRefusal(
      "ineligible-target",
      "Demo seed refused: this one-time initializer accepts no arguments or force flag.",
    );
  }

  const preflight = preflightDatabaseOpen();
  console.log(`Demo seed target: ${preflight.databasePath}`);
  const sqlite = openExistingDemoSeedTarget(preflight.databasePath);
  try {
    const db = drizzle(sqlite, { schema });
    const result = seedDemoData(db);
    console.log(
      `Demo seed complete: ${result.accounts} accounts, ${result.categories} categories, ${result.transactions} transactions.`,
    );
  } finally {
    sqlite.close();
  }
}

try {
  main();
} catch (error) {
  printFailure(error);
  process.exitCode = 1;
}
