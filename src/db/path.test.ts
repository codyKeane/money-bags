import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REPOSITORY_ROOT_ENV_NAME,
  findRepositoryRoot,
  loadEnvironmentStrict,
  resolveDatabasePath,
} from "./path";

const temporaryDirectories: string[] = [];

function makeTemp(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function makeRepository(): string {
  const root = makeTemp("moneybags-path-root-");
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ moneybagsRepositoryRoot: true })}\n`,
  );
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("findRepositoryRoot", () => {
  it("resolves only from the stable module tree", () => {
    const moduleRoot = makeRepository();
    const moduleDirectory = path.join(moduleRoot, "build", "server", "chunks");
    mkdirSync(moduleDirectory, { recursive: true });

    expect(findRepositoryRoot({ moduleDirectory })).toBe(moduleRoot);
  });

  it("fails closed when the stable module tree has no marker", () => {
    const unmarkedModuleTree = makeTemp("moneybags-unmarked-module-");

    expect(() => findRepositoryRoot({ moduleDirectory: unmarkedModuleTree })).toThrow(
      /Repository root not found/,
    );
  });

  it("accepts only an exact marked root injected by a Next launcher", () => {
    const launcherRoot = makeRepository();
    const nested = path.join(launcherRoot, "nested");
    const alias = path.join(makeTemp("moneybags-launcher-alias-"), "repository");
    mkdirSync(nested);
    symlinkSync(launcherRoot, alias, "dir");
    const inherited = process.env[REPOSITORY_ROOT_ENV_NAME];
    try {
      process.env[REPOSITORY_ROOT_ENV_NAME] = launcherRoot;
      expect(findRepositoryRoot()).toBe(launcherRoot);
      process.env[REPOSITORY_ROOT_ENV_NAME] = nested;
      expect(() => findRepositoryRoot()).toThrow(/must be the marked repository root/);
      process.env[REPOSITORY_ROOT_ENV_NAME] = alias;
      expect(() => findRepositoryRoot()).toThrow(/must be the marked repository root/);
      process.env[REPOSITORY_ROOT_ENV_NAME] = ".";
      expect(() => findRepositoryRoot()).toThrow(/absolute and canonical/);
    } finally {
      if (inherited === undefined) delete process.env[REPOSITORY_ROOT_ENV_NAME];
      else process.env[REPOSITORY_ROOT_ENV_NAME] = inherited;
    }
  });
});

describe("loadEnvironmentStrict", () => {
  it("treats only a truly absent .env as optional", () => {
    const root = makeRepository();
    expect(loadEnvironmentStrict(root, {})).toEqual({
      path: path.join(root, ".env"),
      loaded: false,
      added: 0,
    });

    symlinkSync("missing-env", path.join(root, ".env"));
    expect(() => loadEnvironmentStrict(root, {})).toThrow(/regular file/);
  });

  it("accepts documented Node forms and installs last definitions atomically", () => {
    const root = makeRepository();
    const environment: Record<string, string | undefined> = { EXISTING: "operator" };
    writeFileSync(
      path.join(root, ".env"),
      Buffer.from(
        "\ufeff# comment\r\n" +
          "export EXISTING = ignored\r\n" +
          "EMPTY=\r\n" +
          "PLAIN = value with spaces # outside comment\r\n" +
          "SINGLE='hash # and backslash \\ kept'\r\n" +
          'DOUBLE="line one\\nline two"\r\n' +
          "MULTI=`first\r\nsecond\\path#kept`\r\n" +
          "DUPLICATE=first\r\nDUPLICATE=last\r\n\t  ",
        "utf8",
      ),
    );

    const result = loadEnvironmentStrict(root, environment);

    expect(result).toMatchObject({ loaded: true, added: 6 });
    expect(environment).toEqual({
      EXISTING: "operator",
      EMPTY: "",
      PLAIN: "value with spaces",
      SINGLE: "hash # and backslash \\ kept",
      DOUBLE: "line one\nline two",
      MULTI: "first\nsecond\\path#kept",
      DUPLICATE: "last",
    });
  });

  it("rejects malformed or non-UTF-8 files without partially mutating env", () => {
    const root = makeRepository();
    const invalidFiles: Uint8Array[] = [
      Buffer.from("GOOD=would-have-been-set\nBROKEN", "utf8"),
      Buffer.from('GOOD=would-have-been-set\nBROKEN="unterminated', "utf8"),
      Buffer.from('GOOD=would-have-been-set\nBROKEN="closed" trailing', "utf8"),
      Buffer.from("GOOD=would-have-been-set\nBAD\0KEY=value", "utf8"),
      Buffer.from("GOOD=would-have-been-set\n__proto__=reserved", "utf8"),
      Buffer.from([0xc3, 0x28]),
    ];

    for (const bytes of invalidFiles) {
      const environment = { EXISTING: "unchanged" };
      writeFileSync(path.join(root, ".env"), bytes);
      expect(() => loadEnvironmentStrict(root, environment)).toThrow();
      expect(environment).toEqual({ EXISTING: "unchanged" });
    }
  });
});

describe("resolveDatabasePath", () => {
  it("resolves defaults and portable relative separators below repository data", () => {
    const root = makeRepository();
    expect(resolveDatabasePath(root)).toBe(path.join(root, "data", "finance.db"));
    expect(resolveDatabasePath(root, "data/custom/ledger.sqlite3")).toBe(
      path.join(root, "data", "custom", "ledger.sqlite3"),
    );
    expect(resolveDatabasePath(root, "data\\portable\\ledger.db")).toBe(
      path.join(root, "data", "portable", "ledger.db"),
    );
    expect(existsSync(path.join(root, "data"))).toBe(false);
  });

  it.each([
    "",
    "   ",
    "finance.db",
    "custom/finance.db",
    "../outside.db",
    "data/../outside.db",
    "data/./finance.db",
    "data//finance.db",
    "data\\..\\outside.db",
    "data/finance.db\0hidden",
  ])("rejects unsafe relative target %j without artifacts", (target) => {
    const root = makeRepository();
    expect(() => resolveDatabasePath(root, target)).toThrow();
    expect(existsSync(path.join(root, "data"))).toBe(false);
  });

  it("accepts canonical absolute external targets without creating parents", () => {
    const root = makeRepository();
    const externalRoot = makeTemp("moneybags-external-parent-");
    const parent = path.join(externalRoot, "not-created", "nested");
    const target = path.join(parent, "ledger.db");

    expect(resolveDatabasePath(root, target)).toBe(target);
    expect(existsSync(parent)).toBe(false);
  });

  it("rejects absolute in-repository targets outside data", () => {
    const root = makeRepository();
    expect(() => resolveDatabasePath(root, path.join(root, "ledger.db"))).toThrow(
      /below data/,
    );
    expect(existsSync(path.join(root, "ledger.db"))).toBe(false);
  });

  it("accepts existing regular targets but rejects non-regular targets and parents", () => {
    const root = makeRepository();
    const data = path.join(root, "data");
    mkdirSync(data);
    const regular = path.join(data, "regular.db");
    writeFileSync(regular, "fixture only");
    expect(resolveDatabasePath(root, regular)).toBe(regular);

    const directoryTarget = path.join(data, "directory.db");
    mkdirSync(directoryTarget);
    expect(() => resolveDatabasePath(root, directoryTarget)).toThrow(/regular file/);

    const fileParent = path.join(data, "not-a-directory");
    writeFileSync(fileParent, "fixture only");
    expect(() => resolveDatabasePath(root, path.join(fileParent, "ledger.db"))).toThrow(
      /parent must be a directory/,
    );
  });

  it("rejects target and parent symlinks, including dangling links and loops", () => {
    const root = makeRepository();
    const data = path.join(root, "data");
    const external = makeTemp("moneybags-path-external-");
    const actual = path.join(data, "actual");
    mkdirSync(actual, { recursive: true });
    writeFileSync(path.join(actual, "real.db"), "fixture only");

    symlinkSync(path.join(actual, "real.db"), path.join(data, "target-link.db"));
    expect(() => resolveDatabasePath(root, path.join(data, "target-link.db"))).toThrow(
      /symbolic links/,
    );

    symlinkSync(actual, path.join(data, "parent-link"));
    expect(() =>
      resolveDatabasePath(root, path.join(data, "parent-link", "ledger.db")),
    ).toThrow(/symbolic links/);

    symlinkSync(external, path.join(data, "external-parent"), "dir");
    expect(() =>
      resolveDatabasePath(root, path.join(data, "external-parent", "ledger.db")),
    ).toThrow(/symbolic links/);

    symlinkSync(data, path.join(external, "repository-parent"), "dir");
    expect(() =>
      resolveDatabasePath(root, path.join(external, "repository-parent", "ledger.db")),
    ).toThrow(/symbolic links/);

    symlinkSync("missing-parent", path.join(data, "dangling"));
    expect(() =>
      resolveDatabasePath(root, path.join(data, "dangling", "ledger.db")),
    ).toThrow(/symbolic links/);

    symlinkSync("loop-b", path.join(data, "loop-a"));
    symlinkSync("loop-a", path.join(data, "loop-b"));
    expect(() => resolveDatabasePath(root, path.join(data, "loop-a", "ledger.db"))).toThrow(
      /symbolic links/,
    );
  });

  it("rejects lexical aliases in absolute targets", () => {
    const root = makeRepository();
    const externalRoot = makeTemp("moneybags-external-alias-");
    const alias = `${externalRoot}${path.sep}nested${path.sep}..${path.sep}ledger.db`;
    expect(() => resolveDatabasePath(root, alias)).toThrow(/canonical/);
    expect(existsSync(path.join(externalRoot, "ledger.db"))).toBe(false);
  });
});
