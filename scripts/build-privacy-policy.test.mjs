import { expect, it } from "vitest";
import {
  classifyBuildPath,
  createBuildPrivacyPolicy,
  resolveManifestEntry,
} from "./build-privacy-policy.mjs";

const POSIX_ROOT = "/synthetic/project";
const POSIX_MANIFEST = `${POSIX_ROOT}/.next/server/app/page.js.nft.json`;
const WINDOWS_ROOT = "C:\\Synthetic\\Project";
const WINDOWS_MANIFEST =
  `${WINDOWS_ROOT}\\.next\\server\\app\\page.js.nft.json`;

const posixPolicy = createBuildPrivacyPolicy({
  projectRoot: POSIX_ROOT,
  configuredDatabasePath: "/synthetic/private/ledger.custom",
  runtimeDirectories: [
    `${POSIX_ROOT}/runtime-state`,
    "/synthetic/private/imports",
  ],
});

const windowsPolicy = createBuildPrivacyPolicy({
  projectRoot: WINDOWS_ROOT,
  configuredDatabasePath: "C:\\Private\\Ledger.Custom",
  runtimeDirectories: ["D:\\MoneybagsRuntime"],
});

function safe(projectRelativePath) {
  return { status: "safe", projectRelativePath };
}

function forbidden(policyClass) {
  return { status: "forbidden", policyClass };
}

function classifyPosix(
  projectRelativePath,
  { absolutePath = `${POSIX_ROOT}/${projectRelativePath}`, boundary = "trace" } = {},
) {
  return classifyBuildPath({
    policy: posixPolicy,
    absolutePath,
    projectRelativePath,
    boundary,
  });
}

function classifyWindows(
  projectRelativePath,
  {
    absolutePath = `${WINDOWS_ROOT}\\${projectRelativePath}`,
    boundary = "trace",
  } = {},
) {
  return classifyBuildPath({
    policy: windowsPolicy,
    absolutePath,
    projectRelativePath,
    boundary,
  });
}

it("resolveManifestEntry resolves legitimate traversal from each POSIX manifest", () => {
  expect(
    resolveManifestEntry({
      manifestPath: POSIX_MANIFEST,
      entry: "../../../drizzle/0000_synthetic.sql",
      pathFlavor: "posix",
    }),
  ).toBe(`${POSIX_ROOT}/drizzle/0000_synthetic.sql`);
  expect(
    resolveManifestEntry({
      manifestPath: POSIX_MANIFEST,
      entry: "../../../node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      pathFlavor: "posix",
    }),
  ).toBe(
    `${POSIX_ROOT}/node_modules/better-sqlite3/build/Release/better_sqlite3.node`,
  );
});

it("resolveManifestEntry normalizes mixed separators in POSIX entries", () => {
  expect(
    resolveManifestEntry({
      manifestPath: POSIX_MANIFEST,
      entry: "..\\..\\..\\data/imports\\statement.csv",
      pathFlavor: "posix",
    }),
  ).toBe(`${POSIX_ROOT}/data/imports/statement.csv`);
});

it("resolveManifestEntry normalizes traversal and separators with win32 semantics", () => {
  expect(
    resolveManifestEntry({
      manifestPath: WINDOWS_MANIFEST,
      entry: "..\\..\\..\\drizzle/0000_synthetic.sql",
      pathFlavor: "win32",
    }),
  ).toBe(`${WINDOWS_ROOT}\\drizzle\\0000_synthetic.sql`);
  expect(
    resolveManifestEntry({
      manifestPath: WINDOWS_MANIFEST,
      entry: "..\\..\\..\\node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      pathFlavor: "win32",
    }),
  ).toBe(
    `${WINDOWS_ROOT}\\node_modules\\better-sqlite3\\build\\Release\\better_sqlite3.node`,
  );
});

it("resolveManifestEntry rejects NUL and a foreign absolute path flavor", () => {
  expect(
    () =>
      resolveManifestEntry({
        manifestPath: POSIX_MANIFEST,
        entry: "../../../data/finance.db\0ignored",
        pathFlavor: "posix",
      }),
  ).toThrow(/invalid|NUL/i);
  expect(
    () =>
      resolveManifestEntry({
        manifestPath: POSIX_MANIFEST,
        entry: "C:\\Private\\finance.db",
        pathFlavor: "posix",
      }),
  ).toThrow(/foreign|absolute|invalid/i);
  expect(
    () =>
      resolveManifestEntry({
        manifestPath: WINDOWS_MANIFEST,
        entry: "/private/finance.db",
        pathFlavor: "win32",
      }),
  ).toThrow(/foreign|absolute|invalid/i);
});

it("resolveManifestEntry handles same-flavor Windows drive and UNC absolute paths", () => {
  expect(
    resolveManifestEntry({
      manifestPath: WINDOWS_MANIFEST,
      entry: "D:\\Runtime\\ledger.db",
      pathFlavor: "win32",
    }),
  ).toBe("D:\\Runtime\\ledger.db");
  expect(
    resolveManifestEntry({
      manifestPath: WINDOWS_MANIFEST,
      entry: "\\\\server\\share\\ledger.db",
      pathFlavor: "win32",
    }),
  ).toBe("\\\\server\\share\\ledger.db");
});

it("classifyBuildPath rejects SQLite extensions and sidecars case-insensitively", () => {
  for (const projectRelativePath of [
    "fixtures/ledger.db",
    "fixtures/ledger.SQLITE",
    "fixtures/ledger.Sqlite3",
    "fixtures/ledger.custom-JOURNAL",
    "fixtures/ledger.custom-Wal",
    "fixtures/ledger.custom-sHm",
  ]) {
    expect(classifyPosix(projectRelativePath)).toEqual(forbidden("sqlite-runtime"));
  }

  expect(classifyPosix("fixtures/ledger.db.txt")).toEqual(
    safe("fixtures/ledger.db.txt"),
  );
  expect(classifyPosix("drizzle/0000_synthetic.sql")).toEqual(
    safe("drizzle/0000_synthetic.sql"),
  );
});

it("classifyBuildPath rejects an exact arbitrary configured target and sidecars", () => {
  expect(
    classifyPosix("../private/ledger.custom", {
      absolutePath: "/synthetic/private/ledger.custom",
    }),
  ).toEqual(forbidden("configured-database"));
  for (const suffix of ["-journal", "-WAL", "-ShM"]) {
    expect(
      classifyPosix(`../private/ledger.custom${suffix}`, {
        absolutePath: `/synthetic/private/ledger.custom${suffix}`,
      }),
    ).toEqual(forbidden("configured-sidecar"));
  }
});

it("classifyBuildPath recognizes repository data and configured runtime trees by component", () => {
  expect(classifyPosix("data/imports/statement.csv")).toEqual(
    forbidden("repository-data"),
  );
  expect(classifyPosix("data/backups/archive.custom")).toEqual(
    forbidden("repository-data"),
  );
  expect(classifyPosix("runtime-state/cache.bin")).toEqual(
    forbidden("runtime-directory"),
  );
  expect(
    classifyPosix("../private/imports/statement.csv", {
      absolutePath: "/synthetic/private/imports/statement.csv",
    }),
  ).toEqual(forbidden("runtime-directory"));

  expect(classifyPosix("data-safe/readme.txt")).toEqual(
    safe("data-safe/readme.txt"),
  );
  expect(classifyPosix("runtime-state-safe/cache.bin")).toEqual(
    safe("runtime-state-safe/cache.bin"),
  );
});

it("classifyBuildPath rejects every packaged .env variant", () => {
  for (const projectRelativePath of [
    ".env",
    ".env.local",
    ".env.production.local",
    ".env.example",
    "nested/.ENV.SECRET",
  ]) {
    expect(classifyPosix(projectRelativePath)).toEqual(
      forbidden("private-environment"),
    );
  }
  expect(classifyPosix("config/env.local")).toEqual(safe("config/env.local"));
});

it("standalone policy rejects project-only tests, scripts, deploy files, and root docs", () => {
  const cases = [
    ["src/lib/money.test.ts", "project-test"],
    ["src/test/worker-setup.ts", "project-test"],
    ["scripts/import-csv.ts", "operator-script"],
    ["scripts/check-build-privacy.mjs", "operator-script"],
    ["deploy/finance.service", "deploy-file"],
    ["AGENTS.md", "project-documentation"],
    ["CLAUDE.md", "project-documentation"],
    ["IMPLEMENTATION_GUIDE.md", "project-documentation"],
    ["TODO.md", "project-documentation"],
    ["USER_MANUAL.md", "project-documentation"],
  ];
  for (const [projectRelativePath, policyClass] of cases) {
    expect(
      classifyPosix(projectRelativePath, { boundary: "standalone" }),
    ).toEqual(forbidden(policyClass));
  }
});

it("standalone policy keeps exact runtime assets and permits dependency docs/tests", () => {
  const safePaths = [
    "drizzle/0000_synthetic.sql",
    "drizzle/meta/_journal.json",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    "node_modules/better-sqlite3/README.md",
    "node_modules/better-sqlite3/deps/test_extension.c",
    "scripts/next-telemetry-disabled.cjs",
  ];
  for (const projectRelativePath of safePaths) {
    expect(
      classifyPosix(projectRelativePath, { boundary: "standalone" }),
    ).toEqual(safe(projectRelativePath));
  }
  expect(
    classifyPosix("scripts/not-the-preload.cjs", { boundary: "standalone" }),
  ).toEqual(forbidden("operator-script"));
  expect(
    classifyPosix("scripts/NEXT-TELEMETRY-DISABLED.CJS", {
      boundary: "standalone",
    }),
  ).toEqual(forbidden("operator-script"));
});

it("classifyBuildPath rejects normalized traversal outside the project", () => {
  expect(
    classifyPosix("../../etc/passwd", { absolutePath: "/etc/passwd" }),
  ).toEqual(forbidden("path-escape"));
  expect(
    classifyWindows("..\\..\\Windows\\system.ini", {
      absolutePath: "C:\\Windows\\system.ini",
    }),
  ).toEqual(forbidden("path-escape"));
  expect(
    classifyWindows("\\\\server\\share\\ledger.txt", {
      absolutePath: "\\\\server\\share\\ledger.txt",
    }),
  ).toEqual(forbidden("path-escape"));
  expect(
    classifyPosix("../private/ledger.txt", {
      absolutePath: "C:\\Private\\ledger.txt",
    }),
  ).toEqual(forbidden("foreign-absolute-path"));
});

it("win32 policy compares configured targets and sidecars case-insensitively", () => {
  expect(
    classifyWindows("..\\..\\Private\\ledger.custom", {
      absolutePath: "c:\\private\\ledger.custom",
    }),
  ).toEqual(forbidden("configured-database"));
  expect(
    classifyWindows("..\\..\\Private\\ledger.custom-WAL", {
      absolutePath: "C:\\PRIVATE\\LEDGER.CUSTOM-WAL",
    }),
  ).toEqual(forbidden("configured-sidecar"));
  expect(
    classifyWindows("..\\..\\MoneybagsRuntime\\imports\\row.csv", {
      absolutePath: "d:\\moneybagsruntime\\imports\\row.csv",
    }),
  ).toEqual(forbidden("runtime-directory"));
});

it("win32 policy rejects SQLite paths and unrelated drive roots", () => {
  for (const projectRelativePath of [
    "fixtures\\ledger.DB",
    "fixtures\\ledger.sQlItE",
    "fixtures\\ledger.SQLITE3",
    "fixtures\\ledger.custom-JOURNAL",
    "fixtures\\ledger.custom-wAl",
    "fixtures\\ledger.custom-SHM",
  ]) {
    expect(classifyWindows(projectRelativePath)).toEqual(
      forbidden("sqlite-runtime"),
    );
  }
  expect(
    classifyWindows("..\\..\\Other\\readme.txt", {
      absolutePath: "D:\\Other\\readme.txt",
    }),
  ).toEqual(forbidden("path-escape"));
});

it("win32 policy normalizes mixed separators for project paths", () => {
  expect(
    classifyWindows("drizzle/0000_synthetic.sql", {
      absolutePath: "C:\\Synthetic\\Project/drizzle\\0000_synthetic.sql",
    }),
  ).toEqual(safe("drizzle/0000_synthetic.sql"));
  expect(
    classifyWindows("data\\imports/row.csv", {
      absolutePath: "C:\\Synthetic\\Project/data\\imports\\row.csv",
    }),
  ).toEqual(forbidden("repository-data"));
});

it("win32 resolver and classifier reject trailing-dot, trailing-space, and NUL aliases", () => {
  for (const entry of [
    "..\\..\\..\\safe.\\file.txt",
    "..\\..\\..\\safe \\file.txt",
    "..\\..\\..\\safe\\file.txt\0.db",
  ]) {
    expect(
      () =>
        resolveManifestEntry({
          manifestPath: WINDOWS_MANIFEST,
          entry,
          pathFlavor: "win32",
        }),
    ).toThrow(/invalid|NUL|space|dot/i);
  }

  expect(
    classifyWindows("safe.\\file.txt", {
      absolutePath: `${WINDOWS_ROOT}\\safe.\\file.txt`,
    }),
  ).toEqual(forbidden("invalid-path"));
  expect(
    classifyWindows("safe\\file.txt\0.db", {
      absolutePath: `${WINDOWS_ROOT}\\safe\\file.txt\0.db`,
    }),
  ).toEqual(forbidden("invalid-path"));
});
