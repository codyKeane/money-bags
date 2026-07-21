import { defineConfig } from "drizzle-kit";
import path from "node:path";
import { preflightDatabaseOpen } from "./src/db/preflight";
import { enforcePrivateProcessUmask } from "./src/db/private-process";

enforcePrivateProcessUmask();
const preflight = preflightDatabaseOpen();

export default defineConfig({
  schema: path.join(preflight.repositoryRoot, "src", "db", "schema.ts"),
  // drizzle-kit resolves `out` relative to its process cwd and otherwise
  // prepends `.` to an absolute preflight path during generation. Runtime
  // migration consumers continue to use the fully preflighted absolute path.
  out: path.relative(preflight.repositoryRoot, preflight.migrationsFolder),
  dialect: "sqlite",
  dbCredentials: {
    url: preflight.databasePath,
  },
});
