import {
  lstatSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const REPOSITORY_MARKER = "moneybagsRepositoryRoot";
export const REPOSITORY_ROOT_ENV_NAME = "MONEYBAGS_REPOSITORY_ROOT";
const DEFAULT_DATABASE_TARGET = "data/finance.db";
const MODULE_DIRECTORY = __dirname;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*/;

type Environment = Record<string, string | undefined>;

export interface RepositoryRootSearchOptions {
  readonly moduleDirectory?: string;
}

export interface EnvironmentLoadResult {
  readonly path: string;
  readonly loaded: boolean;
  readonly added: number;
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function readRepositoryMarker(directory: string): boolean {
  const markerPath = path.join(directory, "package.json");
  let stats: Stats;
  try {
    stats = lstatSync(markerPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw new Error("Repository marker lookup failed.", { cause: error });
  }
  if (!stats.isFile()) {
    throw new Error("Repository marker must be a regular package.json file.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch (error) {
    throw new Error("Repository package.json could not be read and parsed.", {
      cause: error,
    });
  }
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as Record<string, unknown>)[REPOSITORY_MARKER] === true
  );
}

function searchFrom(start: string): string | undefined {
  let current: string;
  try {
    current = realpathSync(path.resolve(start));
  } catch (error) {
    throw new Error("Repository-root search location is unavailable.", {
      cause: error,
    });
  }
  if (!lstatSync(current).isDirectory()) {
    throw new Error("Repository-root search location must be a directory.");
  }

  for (;;) {
    if (readRepositoryMarker(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Finds the marked checkout from the stable source/bundle location. Invocation
 * cwd is deliberately irrelevant: a detached or incorrectly packaged module
 * fails closed instead of selecting a different marked checkout.
 */
export function findRepositoryRoot(
  options: RepositoryRootSearchOptions = {},
): string {
  const launcherRoot =
    options.moduleDirectory === undefined
      ? process.env[REPOSITORY_ROOT_ENV_NAME]
      : undefined;
  if (launcherRoot !== undefined) {
    if (!path.isAbsolute(launcherRoot)) {
      throw new Error("Configured launcher root must be absolute and canonical.");
    }
    const requestedLauncherRoot = path.resolve(launcherRoot);
    const canonicalPath = realpathSync(requestedLauncherRoot);
    const canonicalLauncherRoot = searchFrom(canonicalPath);
    if (
      canonicalLauncherRoot === undefined ||
      canonicalPath !== requestedLauncherRoot ||
      canonicalLauncherRoot !== canonicalPath
    ) {
      throw new Error("Configured launcher root must be the marked repository root.");
    }
    return canonicalLauncherRoot;
  }

  const root = searchFrom(options.moduleDirectory ?? MODULE_DIRECTORY);
  if (root !== undefined) return root;
  throw new Error(
    `Repository root not found: package.json must contain ${REPOSITORY_MARKER}=true.`,
  );
}

function consumeLineEnding(input: string, index: number): number {
  if (input[index] === "\r" && input[index + 1] === "\n") return index + 2;
  return index + 1;
}

function validateEnvironmentSyntax(input: string): ReadonlySet<string> {
  if (input.includes("\0")) {
    throw new Error("Environment file is invalid: NUL bytes are not allowed.");
  }

  let index = 0;
  let line = 1;
  const keys = new Set<string>();
  const fail = (reason: string): never => {
    throw new Error(`Environment file is invalid at line ${line}: ${reason}.`);
  };
  const isHorizontalWhitespace = (character: string | undefined) =>
    character === " " || character === "\t";
  const isLineEnding = (character: string | undefined) =>
    character === "\n" || character === "\r";

  while (index < input.length) {
    while (isHorizontalWhitespace(input[index])) index += 1;
    if (index === input.length) break;
    if (isLineEnding(input[index])) {
      index = consumeLineEnding(input, index);
      line += 1;
      continue;
    }
    if (input[index] === "#") {
      while (index < input.length && !isLineEnding(input[index])) index += 1;
      continue;
    }

    if (
      input.startsWith("export", index) &&
      isHorizontalWhitespace(input[index + "export".length])
    ) {
      index += "export".length;
      while (isHorizontalWhitespace(input[index])) index += 1;
    }

    const keyMatch = input.slice(index).match(ENVIRONMENT_KEY_PATTERN);
    const key = keyMatch?.[0] ?? fail("expected a variable name");
    if (key === "__proto__") fail("reserved variable name");
    keys.add(key);
    index += key.length;
    while (isHorizontalWhitespace(input[index])) index += 1;
    if (input[index] !== "=") fail("expected an equals sign");
    index += 1;
    while (isHorizontalWhitespace(input[index])) index += 1;

    const quote = input[index];
    if (quote === '"' || quote === "'" || quote === "`") {
      index += 1;
      let closed = false;
      while (index < input.length) {
        if (input[index] === quote) {
          index += 1;
          closed = true;
          break;
        }
        if (isLineEnding(input[index])) {
          index = consumeLineEnding(input, index);
          line += 1;
        } else {
          index += 1;
        }
      }
      if (!closed) fail("unterminated quoted value");
      while (isHorizontalWhitespace(input[index])) index += 1;
      if (input[index] === "#") {
        while (index < input.length && !isLineEnding(input[index])) index += 1;
      } else if (index < input.length && !isLineEnding(input[index])) {
        fail("unexpected content after a quoted value");
      }
    } else {
      while (
        index < input.length &&
        input[index] !== "#" &&
        !isLineEnding(input[index])
      ) {
        index += 1;
      }
      if (input[index] === "#") {
        while (index < input.length && !isLineEnding(input[index])) index += 1;
      }
    }

    if (isLineEnding(input[index])) {
      index = consumeLineEnding(input, index);
      line += 1;
    }
  }
  return keys;
}

/**
 * Loads the optional root .env with Node's assignment semantics. The accepted
 * structure is blank/comment lines and assignments with an optional `export`,
 * Node variable names, `=`, and empty, unquoted, or single/double/backtick
 * quoted values. Quotes may span lines and contain backslashes; comments are
 * recognized only outside quotes. The whole file is decoded and validated
 * before any missing environment values are installed.
 */
export function loadEnvironmentStrict(
  repositoryRoot: string,
  environment: Environment = process.env,
): Readonly<EnvironmentLoadResult> {
  const envPath = path.join(repositoryRoot, ".env");
  let stats: Stats;
  try {
    stats = lstatSync(envPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return Object.freeze({ path: envPath, loaded: false, added: 0 });
    }
    throw new Error("Environment file lookup failed.", { cause: error });
  }
  if (!stats.isFile()) {
    throw new Error("Environment file must be a regular file.");
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(envPath);
  } catch (error) {
    throw new Error("Environment file could not be read.", {
      cause: error,
    });
  }
  let input: string;
  try {
    input = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error("Environment file is not valid UTF-8.", { cause: error });
  }
  const validatedKeys = validateEnvironmentSyntax(input);

  let parsed: NodeJS.Dict<string>;
  try {
    parsed = parseEnv(input);
  } catch {
    // Do not attach Node's parser error: future implementations could include
    // source excerpts, and environment contents must never escape this helper.
    throw new Error("Environment file could not be parsed.");
  }
  const parsedKeys = Object.keys(parsed);
  if (
    parsedKeys.length !== validatedKeys.size ||
    parsedKeys.some((key) => !validatedKeys.has(key))
  ) {
    throw new Error("Environment file could not be parsed consistently.");
  }

  const pending = Object.entries(parsed).filter(
    ([key]) =>
      !Object.prototype.hasOwnProperty.call(environment, key) ||
      environment[key] === undefined,
  );
  for (const [key, value] of pending) {
    if (value !== undefined) environment[key] = value;
  }
  return Object.freeze({ path: envPath, loaded: true, added: pending.length });
}

function isContainedBy(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function inspectCanonicalTarget(target: string): string {
  const parsed = path.parse(target);
  const segments = target.slice(parsed.root.length).split(path.sep).filter(Boolean);
  if (segments.length === 0) {
    throw new Error("Database target must name a file.");
  }
  let current = parsed.root;
  let nearestExisting = parsed.root;
  let missingAt = segments.length;

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index] as string);
    let stats: Stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        missingAt = index;
        break;
      }
      throw new Error("Database target lookup failed.", { cause: error });
    }
    if (stats.isSymbolicLink()) {
      throw new Error("Database target and its parents must not be symbolic links.");
    }
    const isTarget = index === segments.length - 1;
    if (isTarget) {
      if (!stats.isFile()) {
        throw new Error("Existing database target must be a regular file.");
      }
    } else if (!stats.isDirectory()) {
      throw new Error("Database target parent must be a directory.");
    }
    nearestExisting = current;
  }

  let canonicalAncestor: string;
  try {
    canonicalAncestor = realpathSync(nearestExisting);
  } catch (error) {
    throw new Error("Database target ancestor could not be canonicalized.", {
      cause: error,
    });
  }
  if (canonicalAncestor !== nearestExisting) {
    throw new Error("Database target parent is a non-canonical alias.");
  }
  return path.join(canonicalAncestor, ...segments.slice(missingAt));
}

export function resolveDatabasePath(
  repositoryRoot: string,
  configuredTarget?: string,
): string {
  if (!path.isAbsolute(repositoryRoot)) {
    throw new Error("Repository root must be absolute.");
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(repositoryRoot);
  } catch (error) {
    throw new Error("Repository root could not be canonicalized.", { cause: error });
  }
  if (canonicalRoot !== repositoryRoot || !lstatSync(canonicalRoot).isDirectory()) {
    throw new Error("Repository root must be a canonical directory.");
  }

  const target = configuredTarget ?? DEFAULT_DATABASE_TARGET;
  if (target.length === 0 || target.trim().length === 0) {
    throw new Error("Database target must not be empty.");
  }
  if (target.includes("\0")) {
    throw new Error("Database target must not contain NUL bytes.");
  }

  const explicitlyAbsolute = path.isAbsolute(target);
  let resolved: string;
  if (explicitlyAbsolute) {
    if (path.resolve(target) !== target) {
      throw new Error("Absolute database target must be canonical.");
    }
    resolved = target;
  } else {
    const segments = target.split(/[\\/]/);
    if (
      segments.length < 2 ||
      segments[0] !== "data" ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error("Relative database target must be a normalized path below data/.");
    }
    resolved = path.join(canonicalRoot, ...segments);
  }

  const dataRoot = path.join(canonicalRoot, "data");
  if (resolved === dataRoot) {
    throw new Error("Database target must name a file below data/.");
  }
  const canonicalTarget = inspectCanonicalTarget(resolved);
  if (canonicalTarget !== resolved) {
    throw new Error("Database target must use its canonical path.");
  }

  const lexicalInRepository = isContainedBy(canonicalRoot, resolved);
  const canonicalInRepository = isContainedBy(canonicalRoot, canonicalTarget);
  const lexicalInData = isContainedBy(dataRoot, resolved) && resolved !== dataRoot;
  const canonicalInData =
    isContainedBy(dataRoot, canonicalTarget) && canonicalTarget !== dataRoot;

  if (lexicalInRepository !== canonicalInRepository) {
    throw new Error("Database target crosses the repository boundary canonically.");
  }
  if (
    (lexicalInRepository || canonicalInRepository) &&
    !(lexicalInData && canonicalInData)
  ) {
    throw new Error("In-repository database targets must be below data/.");
  }
  if (!explicitlyAbsolute && !(lexicalInData && canonicalInData)) {
    throw new Error("Relative database target escapes data/.");
  }

  return canonicalTarget;
}
