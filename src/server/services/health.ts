import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";

export interface HealthDatabase {
  get(query: SQL): unknown;
}

export function checkDatabaseHealth(db: HealthDatabase = getDb()): void {
  db.get(sql`select 1`);
}
