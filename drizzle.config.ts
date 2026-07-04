import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next, so load .env ourselves (Node 22 built-in).
try {
  process.loadEnvFile();
} catch {
  // no .env file — fall back to defaults below
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_FILE_NAME ?? "data/finance.db",
  },
});
