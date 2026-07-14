import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, type Stats } from "node:fs";
import path from "node:path";
import {
  REVIEWED_MIGRATION_JOURNAL,
  REVIEWED_MIGRATIONS,
  type ReviewedMigration,
} from "./migration-manifest";
import {
  findRepositoryRoot,
  loadEnvironmentStrict,
  resolveDatabasePath,
  type RepositoryRootSearchOptions,
} from "./path";

type Environment = Record<string, string | undefined>;

interface JournalEntry {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

interface MigrationJournal {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly JournalEntry[];
}

export interface DatabaseOpenPreflight {
  readonly repositoryRoot: string;
  readonly databasePath: string;
  readonly migrationsFolder: string;
}

export interface DatabasePreflightOptions extends RepositoryRootSearchOptions {
  readonly environment?: Environment;
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function isContainedBy(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function requireRegularFile(file: string, containmentRoot: string): Buffer {
  if (!isContainedBy(containmentRoot, file) || file === containmentRoot) {
    throw new Error("Migration asset escapes the migration folder.");
  }

  let stats: Stats;
  try {
    stats = lstatSync(file);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new Error("Required migration asset is missing.", { cause: error });
    }
    throw new Error("Migration asset lookup failed.", { cause: error });
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Migration assets must be regular files, not links.");
  }

  let canonical: string;
  try {
    canonical = realpathSync(file);
  } catch (error) {
    throw new Error("Migration asset could not be canonicalized.", { cause: error });
  }
  if (canonical !== file || !isContainedBy(containmentRoot, canonical)) {
    throw new Error("Migration asset must use a contained canonical path.");
  }

  try {
    return readFileSync(file);
  } catch (error) {
    throw new Error("Migration asset is not readable.", { cause: error });
  }
}

function decodeUtf8(bytes: Uint8Array, description: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${description} is not valid UTF-8.`, { cause: error });
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function parseJournal(bytes: Uint8Array): MigrationJournal {
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(bytes, "Migration journal"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Migration journal")) throw error;
    throw new Error("Migration journal is not valid JSON.", { cause: error });
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, ["version", "dialect", "entries"])
  ) {
    throw new Error("Migration journal has an invalid top-level shape.");
  }

  const journal = value as Record<string, unknown>;
  if (
    typeof journal.version !== "string" ||
    typeof journal.dialect !== "string" ||
    !Array.isArray(journal.entries)
  ) {
    throw new Error("Migration journal metadata is invalid.");
  }

  const entries: JournalEntry[] = journal.entries.map((entry, index) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      !hasExactKeys(entry as Record<string, unknown>, [
        "idx",
        "version",
        "when",
        "tag",
        "breakpoints",
      ])
    ) {
      throw new Error(`Migration journal entry ${index} has an invalid shape.`);
    }
    const candidate = entry as Record<string, unknown>;
    if (
      !Number.isSafeInteger(candidate.idx) ||
      typeof candidate.version !== "string" ||
      !Number.isSafeInteger(candidate.when) ||
      typeof candidate.tag !== "string" ||
      typeof candidate.breakpoints !== "boolean"
    ) {
      throw new Error(`Migration journal entry ${index} has invalid metadata.`);
    }
    return {
      idx: candidate.idx as number,
      version: candidate.version,
      when: candidate.when as number,
      tag: candidate.tag,
      breakpoints: candidate.breakpoints,
    };
  });
  return { version: journal.version, dialect: journal.dialect, entries };
}

function assertReviewedEntry(
  actual: JournalEntry,
  expected: ReviewedMigration,
  index: number,
): void {
  if (
    actual.idx !== expected.idx ||
    actual.version !== expected.version ||
    actual.when !== expected.when ||
    actual.tag !== expected.tag ||
    actual.breakpoints !== expected.breakpoints
  ) {
    throw new Error(`Migration journal entry ${index} does not match the reviewed manifest.`);
  }
}

export function validateMigrationAssets(repositoryRoot: string): string {
  const migrationsFolder = path.join(repositoryRoot, "drizzle");
  const metaFolder = path.join(migrationsFolder, "meta");
  for (const [directory, label] of [
    [migrationsFolder, "Migration folder"],
    [metaFolder, "Migration metadata folder"],
  ] as const) {
    let stats: Stats;
    try {
      stats = lstatSync(directory);
    } catch (error) {
      throw new Error(`${label} is unavailable.`, { cause: error });
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`${label} must be a regular directory, not a link.`);
    }
    let canonical: string;
    try {
      canonical = realpathSync(directory);
    } catch (error) {
      throw new Error(`${label} could not be canonicalized.`, { cause: error });
    }
    if (canonical !== directory || !isContainedBy(repositoryRoot, canonical)) {
      throw new Error(`${label} must be canonical and contained by the repository.`);
    }
  }

  const journalPath = path.join(metaFolder, "_journal.json");
  const journal = parseJournal(requireRegularFile(journalPath, migrationsFolder));
  if (
    journal.version !== REVIEWED_MIGRATION_JOURNAL.version ||
    journal.dialect !== REVIEWED_MIGRATION_JOURNAL.dialect
  ) {
    throw new Error("Migration journal header does not match the reviewed manifest.");
  }
  if (journal.entries.length !== REVIEWED_MIGRATIONS.length) {
    throw new Error("Migration journal length does not match the reviewed manifest.");
  }

  const indexes = new Set<number>();
  const tags = new Set<string>();
  let previousWhen = -1;
  for (const [index, entry] of journal.entries.entries()) {
    if (entry.idx !== index || indexes.has(entry.idx)) {
      throw new Error("Migration journal indexes must be ordered and unique.");
    }
    if (
      !/^\d{4}_[a-z0-9_]+$/.test(entry.tag) ||
      !entry.tag.startsWith(`${String(index).padStart(4, "0")}_`) ||
      tags.has(entry.tag)
    ) {
      throw new Error("Migration journal tags must be safe, ordered, and unique.");
    }
    if (entry.when <= previousWhen) {
      throw new Error("Migration journal timestamps must be strictly increasing.");
    }
    indexes.add(entry.idx);
    tags.add(entry.tag);
    previousWhen = entry.when;

    const expected = REVIEWED_MIGRATIONS[index];
    if (expected === undefined) {
      throw new Error("Migration is not represented in the reviewed manifest.");
    }
    assertReviewedEntry(entry, expected, index);

    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    const digest = createHash("sha256")
      .update(requireRegularFile(sqlPath, migrationsFolder))
      .digest("hex");
    if (digest !== expected.sha256) {
      throw new Error(`Migration SQL checksum failed for reviewed entry ${index}.`);
    }
  }

  return migrationsFolder;
}

function freezeConfig(
  repositoryRoot: string,
  databasePath: string,
  migrationsFolder: string,
): Readonly<DatabaseOpenPreflight> {
  return Object.freeze({ repositoryRoot, databasePath, migrationsFolder });
}

/** Runs strict env -> database-path -> migration checks, in that order. */
export function preflightDatabaseOpen(
  options: DatabasePreflightOptions = {},
): Readonly<DatabaseOpenPreflight> {
  const repositoryRoot = findRepositoryRoot(options);
  const environment = options.environment ?? process.env;
  loadEnvironmentStrict(repositoryRoot, environment);
  const databasePath = resolveDatabasePath(repositoryRoot, environment.DB_FILE_NAME);
  const migrationsFolder = validateMigrationAssets(repositoryRoot);
  return freezeConfig(repositoryRoot, databasePath, migrationsFolder);
}

/** Test/operational adapter that intentionally skips .env and requires absolute input. */
export function preflightExplicitDatabaseOpen(
  databaseTarget: string,
  options: RepositoryRootSearchOptions = {},
): Readonly<DatabaseOpenPreflight> {
  if (!path.isAbsolute(databaseTarget)) {
    throw new Error("Explicit database target must be absolute.");
  }
  const repositoryRoot = findRepositoryRoot(options);
  const databasePath = resolveDatabasePath(repositoryRoot, databaseTarget);
  const migrationsFolder = validateMigrationAssets(repositoryRoot);
  return freezeConfig(repositoryRoot, databasePath, migrationsFolder);
}
