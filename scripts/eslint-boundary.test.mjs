import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eslint = new ESLint({ cwd: PROJECT_ROOT });
const BOUNDARY_RULE_IDS = new Set(["no-restricted-imports", "no-restricted-syntax"]);

async function boundaryMessages(source, relativeFilename) {
  const [result] = await eslint.lintText(source, {
    filePath: path.join(PROJECT_ROOT, relativeFilename),
    warnIgnored: false,
  });
  if (!result) throw new Error("ESLint returned no synthetic boundary result.");
  return result.messages.filter((message) => BOUNDARY_RULE_IDS.has(message.ruleId));
}

describe("services-only database lint boundary", () => {
  const restrictedSources = [
    'import { getDb } from "@/db";',
    'import { getDb } from "@/db/client";',
    'import type { Db } from "../../db/client";',
    'import { schema } from "../../../src/db/schema";',
    'export { accounts } from "../shared/db/schema";',
    'import { sql } from "drizzle-orm";',
    'import { sqliteTable } from "drizzle-orm/sqlite-core";',
    'import Database from "better-sqlite3";',
  ];

  it.each([
    "src/app/synthetic-boundary.ts",
    "src/components/synthetic-boundary.tsx",
    "src/server/actions/synthetic-boundary.ts",
  ])("rejects static DB/query imports and re-exports from %s", async (filename) => {
    for (const source of restrictedSources) {
      const messages = await boundaryMessages(source, filename);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ ruleId: "no-restricted-imports", severity: 2 });
    }
  });

  it.each([
    'type Synthetic = import("@/db/client").Db;',
    'type Synthetic = import("../../../src/db/schema").accounts;',
    'type Synthetic = typeof import("drizzle-orm");',
    'type Synthetic = typeof import("better-sqlite3");',
  ])("rejects restricted inline import type %s", async (source) => {
    const messages = await boundaryMessages(source, "src/app/synthetic-boundary.ts");

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ruleId: "no-restricted-syntax", severity: 2 });
  });

  it("allows service imports from protected layers", async () => {
    await expect(
      boundaryMessages(
        'import { listAccounts } from "@/server/services/accounts";',
        "src/app/synthetic-boundary.ts",
      ),
    ).resolves.toEqual([]);
  });

  it.each([
    "src/app/synthetic-boundary.test.ts",
    "src/server/services/synthetic-boundary.ts",
    "src/db/synthetic-boundary.ts",
    "scripts/synthetic-boundary.mjs",
  ])("keeps documented boundary exemptions at %s", async (filename) => {
    for (const source of [
      'import { sql } from "drizzle-orm";',
      'type Synthetic = import("@/db/client").Db;',
    ]) {
      await expect(boundaryMessages(source, filename)).resolves.toEqual([]);
    }
  });
});
