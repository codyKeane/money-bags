import { defineConfig } from "drizzle-kit";
import path from "node:path";
import { preflightDatabaseOpen } from "./src/db/preflight";
import { enforcePrivateProcessUmask } from "./src/db/private-process";

enforcePrivateProcessUmask();
const preflight = preflightDatabaseOpen();

export default defineConfig({
  schema: path.join(preflight.repositoryRoot, "src", "db", "schema.ts"),
  out: preflight.migrationsFolder,
  dialect: "sqlite",
  dbCredentials: {
    url: preflight.databasePath,
  },
});
