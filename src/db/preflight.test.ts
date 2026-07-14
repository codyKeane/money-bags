import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REVIEWED_MIGRATIONS } from "./migration-manifest";
import { findRepositoryRoot } from "./path";
import {
  preflightDatabaseOpen,
  preflightExplicitDatabaseOpen,
  validateMigrationAssets,
} from "./preflight";

interface MutableJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface MutableJournal {
  version: string;
  dialect: string;
  entries: MutableJournalEntry[];
  extra?: boolean;
}

const sourceRoot = findRepositoryRoot({ moduleDirectory: __dirname });
const temporaryDirectories: string[] = [];

function makeTemp(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function makeRepositoryFixture(): string {
  const root = makeTemp("moneybags-preflight-root-");
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ moneybagsRepositoryRoot: true })}\n`,
  );
  mkdirSync(path.join(root, "bundle"));
  mkdirSync(path.join(root, "drizzle", "meta"), { recursive: true });
  copyFileSync(
    path.join(sourceRoot, "drizzle", "meta", "_journal.json"),
    path.join(root, "drizzle", "meta", "_journal.json"),
  );
  for (const migration of REVIEWED_MIGRATIONS) {
    copyFileSync(
      path.join(sourceRoot, "drizzle", `${migration.tag}.sql`),
      path.join(root, "drizzle", `${migration.tag}.sql`),
    );
  }
  return root;
}

function readJournal(root: string): MutableJournal {
  return JSON.parse(
    readFileSync(path.join(root, "drizzle", "meta", "_journal.json"), "utf8"),
  ) as MutableJournal;
}

function writeJournal(root: string, journal: MutableJournal): void {
  writeFileSync(
    path.join(root, "drizzle", "meta", "_journal.json"),
    `${JSON.stringify(journal, null, 2)}\n`,
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("validateMigrationAssets", () => {
  it("accepts the fixed reviewed journal and SQL byte manifest", () => {
    const root = makeRepositoryFixture();
    expect(validateMigrationAssets(root)).toBe(path.join(root, "drizzle"));
  });

  it.each([
    {
      name: "malformed JSON",
      mutate(root: string) {
        writeFileSync(path.join(root, "drizzle", "meta", "_journal.json"), "{");
      },
    },
    {
      name: "an extra top-level field",
      mutate(root: string) {
        const journal = readJournal(root);
        journal.extra = true;
        writeJournal(root, journal);
      },
    },
    {
      name: "out-of-order indexes",
      mutate(root: string) {
        const journal = readJournal(root);
        const first = journal.entries[0];
        const second = journal.entries[1];
        if (first === undefined || second === undefined) throw new Error("fixture incomplete");
        [journal.entries[0], journal.entries[1]] = [second, first];
        writeJournal(root, journal);
      },
    },
    {
      name: "a duplicate tag",
      mutate(root: string) {
        const journal = readJournal(root);
        const first = journal.entries[0];
        const second = journal.entries[1];
        if (first === undefined || second === undefined) throw new Error("fixture incomplete");
        second.tag = first.tag;
        writeJournal(root, journal);
      },
    },
    {
      name: "a traversal tag",
      mutate(root: string) {
        const journal = readJournal(root);
        const first = journal.entries[0];
        if (first === undefined) throw new Error("fixture incomplete");
        first.tag = "../0000_escape";
        writeJournal(root, journal);
      },
    },
    {
      name: "changed historical SQL bytes",
      mutate(root: string) {
        const first = REVIEWED_MIGRATIONS[0];
        if (first === undefined) throw new Error("fixture incomplete");
        writeFileSync(path.join(root, "drizzle", `${first.tag}.sql`), "-- changed\n");
      },
    },
    {
      name: "a missing SQL file",
      mutate(root: string) {
        const first = REVIEWED_MIGRATIONS[0];
        if (first === undefined) throw new Error("fixture incomplete");
        rmSync(path.join(root, "drizzle", `${first.tag}.sql`));
      },
    },
    {
      name: "a non-regular SQL target",
      mutate(root: string) {
        const first = REVIEWED_MIGRATIONS[0];
        if (first === undefined) throw new Error("fixture incomplete");
        const sql = path.join(root, "drizzle", `${first.tag}.sql`);
        rmSync(sql);
        mkdirSync(sql);
      },
    },
    {
      name: "a SQL symlink",
      mutate(root: string) {
        const first = REVIEWED_MIGRATIONS[0];
        const second = REVIEWED_MIGRATIONS[1];
        if (first === undefined || second === undefined) throw new Error("fixture incomplete");
        const sql = path.join(root, "drizzle", `${first.tag}.sql`);
        rmSync(sql);
        symlinkSync(`${second.tag}.sql`, sql);
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const root = makeRepositoryFixture();
    mutate(root);
    expect(() => validateMigrationAssets(root)).toThrow();
  });
});

describe("database-open preflight", () => {
  it("returns a deeply immutable normalized config", () => {
    const root = makeRepositoryFixture();
    const target = path.join(root, "data", "fixture.db");
    const config = preflightDatabaseOpen({
      moduleDirectory: path.join(root, "bundle"),
      environment: { DB_FILE_NAME: target },
    });

    expect(config).toEqual({
      repositoryRoot: root,
      databasePath: target,
      migrationsFolder: path.join(root, "drizzle"),
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(existsSync(path.join(root, "data"))).toBe(false);
  });

  it("fails in env -> path -> migrations order without creating DB artifacts", () => {
    const root = makeRepositoryFixture();
    const external = makeTemp("moneybags-preflight-target-");
    const targetParent = path.join(external, "must-not-exist");
    const target = path.join(targetParent, "fixture.db");
    const options = {
      moduleDirectory: path.join(root, "bundle"),
    };
    writeFileSync(path.join(root, "drizzle", "meta", "_journal.json"), "{");

    writeFileSync(path.join(root, ".env"), "BROKEN");
    expect(() =>
      preflightDatabaseOpen({
        ...options,
        environment: { DB_FILE_NAME: "finance.db" },
      }),
    ).toThrow(/Environment file/);
    expect(existsSync(targetParent)).toBe(false);

    writeFileSync(path.join(root, ".env"), "# valid\n");
    expect(() =>
      preflightDatabaseOpen({
        ...options,
        environment: { DB_FILE_NAME: "finance.db" },
      }),
    ).toThrow(/Relative database target/);
    expect(existsSync(targetParent)).toBe(false);

    expect(() =>
      preflightDatabaseOpen({ ...options, environment: { DB_FILE_NAME: target } }),
    ).toThrow(/Migration journal/);
    expect(existsSync(targetParent)).toBe(false);
  });

  it("explicit-target preflight requires absolute input and never loads .env", () => {
    const root = makeRepositoryFixture();
    const options = { moduleDirectory: path.join(root, "bundle") };
    writeFileSync(path.join(root, ".env"), "MALFORMED");
    const external = makeTemp("moneybags-explicit-target-");
    const target = path.join(external, "not-created", "fixture.db");

    expect(preflightExplicitDatabaseOpen(target, options).databasePath).toBe(target);
    expect(existsSync(path.dirname(target))).toBe(false);
    expect(() => preflightExplicitDatabaseOpen("data/fixture.db", options)).toThrow(
      /must be absolute/,
    );
  });

  it("resolves the real module anchor identically from an unrelated cwd", () => {
    const unrelatedCwd = makeTemp("moneybags-unrelated-cwd-");
    const external = makeTemp("moneybags-cross-cwd-target-");
    const target = path.join(external, "not-created", "fixture.db");
    const originalCwd = process.cwd();

    try {
      process.chdir(unrelatedCwd);
      expect(preflightExplicitDatabaseOpen(target)).toEqual({
        repositoryRoot: sourceRoot,
        databasePath: target,
        migrationsFolder: path.join(sourceRoot, "drizzle"),
      });
    } finally {
      process.chdir(originalCwd);
    }
    expect(existsSync(path.dirname(target))).toBe(false);
  });
});

describe("database adapter contract", () => {
  it("keeps entry points on the shared cwd-independent resolver", () => {
    const source = (file: string) => readFileSync(path.join(sourceRoot, file), "utf8");
    const adapters = [
      "src/db/client.ts",
      "drizzle.config.ts",
      "scripts/backup-db.ts",
      "scripts/import-csv.ts",
      "src/db/seed.ts",
    ].map(source);

    for (const adapter of adapters) {
      expect(adapter).not.toContain("process.loadEnvFile");
      expect(adapter).not.toContain("process.cwd(");
    }
    expect(adapters[0]).toContain("preflightDatabaseOpen()");
    expect(adapters[1]).toContain("preflightDatabaseOpen()");
    expect(adapters[2]).toContain("preflightDatabaseOpen().databasePath");
    expect(adapters[3]).toContain("../src/server/services/import");
    expect(adapters[4]).toContain('getDb } from "./client"');
  });
});
