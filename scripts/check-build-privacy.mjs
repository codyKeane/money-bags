#!/usr/bin/env node
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyBuildPath,
  createBuildPrivacyPolicy,
  resolveManifestEntry,
} from "./build-privacy-policy.mjs";

const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const TELEMETRY_PRELOAD = "scripts/next-telemetry-disabled.cjs";
const repositoryRoot = realpathSync.native(path.resolve(import.meta.dirname, ".."));

function safeDiagnosticToken(value) {
  return String(value)
    .replaceAll("\\", "/")
    .replace(/[^a-zA-Z0-9._/-]/g, "?")
    .slice(0, 240);
}

function violation(policyClass, details = {}) {
  return Object.freeze({ policyClass, ...details });
}

function manifestLocation(buildRoot, manifestPath) {
  return safeDiagnosticToken(path.relative(buildRoot, manifestPath));
}

function requiredRuntimeAssets(projectRoot) {
  let migrations = [];
  try {
    migrations = readdirSync(path.join(projectRoot, "drizzle"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => `drizzle/${entry.name}`)
      .sort();
  } catch {
    // Missing source migration metadata becomes a missing required asset below.
  }
  return Object.freeze([
    { id: "migration-journal", path: "drizzle/meta/_journal.json" },
    ...migrations.map((migrationPath, index) => ({
      id: `migration-sql-${index + 1}`,
      path: migrationPath,
    })),
    {
      id: "sqlite-native-binding",
      path: "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    },
    {
      id: "sqlite-package-metadata",
      path: "node_modules/better-sqlite3/package.json",
    },
    {
      id: "sqlite-package-entry",
      path: "node_modules/better-sqlite3/lib/index.js",
    },
    { id: "telemetry-preload", path: TELEMETRY_PRELOAD },
  ]);
}

function collectTraceManifests(buildRoot, violations, policy) {
  const manifests = [];
  const visitedDirectories = new Set();
  let rootMetadata;
  try {
    rootMetadata = lstatSync(buildRoot);
  } catch {
    violations.push(violation("missing-build-output"));
    return manifests;
  }
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    violations.push(violation("invalid-build-output"));
    return manifests;
  }

  function walk(directory, displayDirectory = directory) {
    let canonicalDirectory;
    try {
      canonicalDirectory = realpathSync.native(directory);
    } catch {
      violations.push(violation("unreadable-build-output"));
      return;
    }
    if (visitedDirectories.has(canonicalDirectory)) return;
    visitedDirectories.add(canonicalDirectory);
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      violations.push(violation("unreadable-build-output"));
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const displayAbsolute = path.join(displayDirectory, entry.name);
      let metadata;
      try {
        metadata = lstatSync(absolute);
      } catch {
        violations.push(violation("unreadable-build-output"));
        continue;
      }
      if (metadata.isSymbolicLink()) {
        if (entry.name.endsWith(".nft.json")) {
          violations.push(
            violation("symlink-escape", {
              manifest: manifestLocation(buildRoot, displayAbsolute),
            }),
          );
          continue;
        }
        let target;
        let targetMetadata;
        try {
          target = realpathSync.native(absolute);
          targetMetadata = lstatSync(target);
        } catch {
          violations.push(
            violation("symlink-escape", {
              manifest: manifestLocation(buildRoot, displayAbsolute),
            }),
          );
          continue;
        }
        if (targetMetadata.isDirectory()) {
          const targetResult = classifyBuildPath({
            policy,
            absolutePath: target,
            projectRelativePath: path.relative(policy.projectRoot, target),
            boundary: "trace",
          });
          if (targetResult.status === "forbidden") {
            violations.push(
              violation("symlink-escape", {
                manifest: manifestLocation(buildRoot, displayAbsolute),
              }),
            );
          } else {
            walk(target, displayAbsolute);
          }
        }
        continue;
      }
      if (metadata.isDirectory()) {
        walk(absolute, displayAbsolute);
      } else if (entry.name.endsWith(".nft.json")) {
        manifests.push({ absolute, displayAbsolute, metadata });
      }
    }
  }

  walk(buildRoot);
  manifests.sort((left, right) => left.absolute.localeCompare(right.absolute));
  return manifests;
}

function classifyManifestEntry({
  manifestPath,
  manifestDisplayPath = manifestPath,
  entry,
  entryIndex,
  buildRoot,
  policy,
}) {
  const manifest = manifestLocation(buildRoot, manifestDisplayPath);
  const manifestPaths = new Set([manifestPath, manifestDisplayPath]);
  const projectRelativePaths = new Set();
  for (const containingManifest of manifestPaths) {
    let absolutePath;
    try {
      absolutePath = resolveManifestEntry({
        manifestPath: containingManifest,
        entry,
        pathFlavor: policy.pathFlavor,
      });
    } catch (error) {
      return {
        result: violation(
          error?.code === "ERR_BUILD_PRIVACY_FOREIGN_ABSOLUTE_PATH"
            ? "foreign-absolute-path"
            : "invalid-path",
          { manifest, entry: entryIndex + 1 },
        ),
      };
    }
    const result = classifyBuildPath({
      policy,
      absolutePath,
      projectRelativePath: path.relative(policy.projectRoot, absolutePath),
      boundary: "trace",
    });
    if (result.status === "forbidden") {
      return {
        result: violation(result.policyClass, {
          manifest,
          entry: entryIndex + 1,
        }),
      };
    }
    projectRelativePaths.add(result.projectRelativePath);
  }
  return { projectRelativePaths };
}

/** Inspect every NFT manifest without opening any traced target. */
export function inspectTraceManifests({
  projectRoot,
  buildRoot = path.join(projectRoot, ".next"),
  policy,
  requiredAssets,
  maxManifestBytes = MAX_MANIFEST_BYTES,
}) {
  const violations = [];
  const manifests = collectTraceManifests(buildRoot, violations, policy);
  const traceEntries = new Set();
  let entriesScanned = 0;

  if (manifests.length === 0 && violations.length === 0) {
    violations.push(violation("missing-trace-manifest"));
  }

  for (const {
    absolute: manifestPath,
    displayAbsolute: manifestDisplayPath,
    metadata,
  } of manifests) {
    const manifest = manifestLocation(buildRoot, manifestDisplayPath);
    if (!metadata.isFile() || metadata.size > maxManifestBytes) {
      violations.push(violation("invalid-trace-manifest", { manifest }));
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      violations.push(violation("invalid-trace-manifest", { manifest }));
      continue;
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.files) ||
      !parsed.files.every((entry) => typeof entry === "string")
    ) {
      violations.push(violation("invalid-trace-manifest", { manifest }));
      continue;
    }
    parsed.files.forEach((entry, entryIndex) => {
      entriesScanned += 1;
      const classified = classifyManifestEntry({
        manifestPath,
        manifestDisplayPath,
        entry,
        entryIndex,
        buildRoot,
        policy,
      });
      if (classified.result) violations.push(classified.result);
      if (classified.projectRelativePaths) {
        for (const projectRelativePath of classified.projectRelativePaths) {
          traceEntries.add(projectRelativePath);
        }
      }
    });
  }

  const assets = requiredAssets ?? requiredRuntimeAssets(projectRoot);
  for (const asset of assets) {
    if (!traceEntries.has(asset.path.replaceAll("\\", "/"))) {
      violations.push(
        violation("missing-required-runtime-asset", {
          asset: safeDiagnosticToken(asset.id),
        }),
      );
    }
  }

  return Object.freeze({
    boundary: "trace",
    ok: violations.length === 0,
    manifestsScanned: manifests.length,
    entriesScanned,
    pathsScanned: 0,
    violations: Object.freeze(violations),
  });
}

function standaloneRelative(standaloneRoot, absolutePath) {
  return path.relative(standaloneRoot, absolutePath).replaceAll("\\", "/");
}

/** Inspect the full standalone tree by lexical path and symlink target. */
export function inspectStandaloneTree({
  projectRoot,
  standaloneRoot = path.join(projectRoot, ".next", "standalone"),
  policy,
  requiredAssets,
}) {
  const violations = [];
  const packagedFiles = new Set();
  let pathsScanned = 0;
  let rootMetadata;
  try {
    rootMetadata = lstatSync(standaloneRoot);
  } catch {
    violations.push(violation("missing-standalone-output"));
  }
  if (
    rootMetadata &&
    (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink())
  ) {
    violations.push(violation("invalid-standalone-output"));
    rootMetadata = undefined;
  }

  function classifyTreePath(absolutePath, entryIndex) {
    const relative = standaloneRelative(standaloneRoot, absolutePath);
    const classified = classifyBuildPath({
      policy,
      absolutePath,
      projectRelativePath: relative,
      boundary: "standalone",
    });
    if (classified.status === "forbidden") {
      violations.push(
        violation(classified.policyClass, { entry: entryIndex }),
      );
      return undefined;
    }
    return classified.projectRelativePath;
  }

  function walk(directory) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      violations.push(violation("unreadable-standalone-output"));
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      pathsScanned += 1;
      const entryIndex = pathsScanned;
      let metadata;
      try {
        metadata = lstatSync(absolute);
      } catch {
        violations.push(violation("unreadable-standalone-output", { entry: entryIndex }));
        continue;
      }
      const classifiedPath = classifyTreePath(absolute, entryIndex);
      if (metadata.isSymbolicLink()) {
        let target;
        try {
          target = realpathSync.native(absolute);
        } catch {
          violations.push(violation("symlink-escape", { entry: entryIndex }));
          continue;
        }
        const relativeTarget = path.relative(standaloneRoot, target);
        if (
          path.isAbsolute(relativeTarget) ||
          relativeTarget === ".." ||
          relativeTarget.startsWith(`..${path.sep}`)
        ) {
          violations.push(violation("symlink-escape", { entry: entryIndex }));
          continue;
        }
        const targetResult = classifyBuildPath({
          policy,
          absolutePath: target,
          projectRelativePath: relativeTarget,
          boundary: "standalone",
        });
        if (targetResult.status === "forbidden") {
          violations.push(
            violation(targetResult.policyClass, { entry: entryIndex }),
          );
        }
        continue;
      }
      if (metadata.isDirectory()) walk(absolute);
      else if (metadata.isFile()) {
        if (classifiedPath) packagedFiles.add(classifiedPath);
      } else {
        violations.push(violation("invalid-standalone-entry", { entry: entryIndex }));
      }
    }
  }

  if (rootMetadata) walk(standaloneRoot);

  const assets = requiredAssets ?? [
    { id: "server-entry", path: "server.js" },
    ...requiredRuntimeAssets(projectRoot),
  ];
  for (const asset of assets) {
    if (!packagedFiles.has(asset.path.replaceAll("\\", "/"))) {
      violations.push(
        violation("missing-required-runtime-asset", {
          asset: safeDiagnosticToken(asset.id),
        }),
      );
    }
  }

  return Object.freeze({
    boundary: "standalone",
    ok: violations.length === 0,
    manifestsScanned: 0,
    entriesScanned: 0,
    pathsScanned,
    violations: Object.freeze(violations),
  });
}

export function formatPrivacyReport(report) {
  const counts =
    report.boundary === "trace"
      ? `manifests=${report.manifestsScanned} entries=${report.entriesScanned}`
      : `paths=${report.pathsScanned}`;
  if (report.ok) return `build-privacy: PASS boundary=${report.boundary} ${counts}`;
  const lines = [`build-privacy: FAIL boundary=${report.boundary} ${counts}`];
  for (const item of report.violations) {
    const fields = [];
    if (item.manifest) fields.push(`manifest=${item.manifest}`);
    if (item.entry) fields.push(`entry=${item.entry}`);
    if (item.asset) fields.push(`asset=${item.asset}`);
    fields.push(`class=${item.policyClass}`);
    lines.push(fields.join(" "));
  }
  return lines.join("\n");
}

function configuredTarget(root, environment) {
  const configured = environment.DB_FILE_NAME ?? path.join("data", "finance.db");
  return path.isAbsolute(configured) ? configured : path.resolve(root, configured);
}

export function runPrivacyCheck({
  argv = [],
  projectRoot = repositoryRoot,
  environment = process.env,
}) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--standalone")) {
    throw new Error("Usage: node scripts/check-build-privacy.mjs [--standalone]");
  }
  const standalone = argv[0] === "--standalone";
  const scanRoot = standalone
    ? path.join(projectRoot, ".next", "standalone")
    : projectRoot;
  const policy = createBuildPrivacyPolicy({
    projectRoot: scanRoot,
    configuredDatabasePath: configuredTarget(scanRoot, environment),
    runtimeDirectories: ["data", "imports", "backups"],
  });
  return standalone
    ? inspectStandaloneTree({
        projectRoot,
        standaloneRoot: scanRoot,
        policy,
      })
    : inspectTraceManifests({ projectRoot, policy });
}

export function main(argv = process.argv.slice(2)) {
  let report;
  try {
    report = runPrivacyCheck({ argv });
  } catch {
    process.stderr.write("build-privacy: FAIL class=checker-error\n");
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`${formatPrivacyReport(report)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
