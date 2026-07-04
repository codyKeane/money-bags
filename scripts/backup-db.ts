// npm run db:backup — WAL-safe online backup to data/backups/.
// Uses better-sqlite3's incremental backup API, so it is safe to run while
// the server is up (a plain file copy would miss transactions still in the
// -wal file). Restore: stop the server, copy the backup over
// data/finance.db, delete stale finance.db-wal / -shm, restart.
try {
  process.loadEnvFile();
} catch {
  // no .env — default path applies
}

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { resolveDbPath } from "../src/db/client";

async function main(): Promise<void> {
  const src = resolveDbPath();
  if (!fs.existsSync(src)) {
    console.error(`No database found at ${src} — nothing to back up.`);
    process.exit(2);
  }
  const dir = path.join(path.dirname(src), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(dir, `finance-${stamp}.db`);

  const db = new Database(src, { readonly: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  const size = fs.statSync(dest).size;
  console.log(`Backed up ${src} -> ${dest} (${size} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
