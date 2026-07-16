import path from "node:path";

const SQLITE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const SQLITE_SIDECARS = ["-journal", "-wal", "-shm"];
const WINDOWS_ABSOLUTE = /^(?:[a-z]:[\\/]|[\\/]{2})/i;
const WINDOWS_DEVICE = /^(?:[\\/]{2}[?.][\\/]|\\\\[?.]\\)/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const ROOT_DOCUMENTATION = new Set([
  "agents.md",
  "claude.md",
  "readme.md",
  "todo.md",
  "user_manual.md",
]);

function privacyPathError(code) {
  const error = new Error("Build privacy path is invalid.");
  error.code = code;
  return error;
}

function inferPathFlavor(value) {
  return WINDOWS_ABSOLUTE.test(value) || WINDOWS_DEVICE.test(value)
    ? "win32"
    : "posix";
}

function pathImplementation(pathFlavor) {
  if (pathFlavor === "posix") return path.posix;
  if (pathFlavor === "win32") return path.win32;
  throw privacyPathError("ERR_BUILD_PRIVACY_INVALID_PATH_FLAVOR");
}

function separatorsForFlavor(value, pathFlavor) {
  return pathFlavor === "win32"
    ? value.replaceAll("/", "\\")
    : value.replaceAll("\\", "/");
}

function validateWindowsPath(value) {
  if (WINDOWS_DEVICE.test(value)) {
    throw privacyPathError("ERR_BUILD_PRIVACY_INVALID_PATH");
  }
  const parsed = path.win32.parse(value);
  const remainder = value.slice(parsed.root.length);
  for (const component of remainder.split(/[\\/]+/)) {
    if (!component || component === "." || component === "..") continue;
    if (/[ .]$/.test(component) || WINDOWS_RESERVED.test(component)) {
      throw privacyPathError("ERR_BUILD_PRIVACY_INVALID_PATH");
    }
  }
}

function validatePathString(value, pathFlavor) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw privacyPathError("ERR_BUILD_PRIVACY_INVALID_PATH");
  }
  if (pathFlavor === "posix" && WINDOWS_ABSOLUTE.test(value)) {
    throw privacyPathError("ERR_BUILD_PRIVACY_FOREIGN_ABSOLUTE_PATH");
  }
  if (pathFlavor === "win32" && /^[\\/](?![\\/])/.test(value)) {
    throw privacyPathError("ERR_BUILD_PRIVACY_FOREIGN_ABSOLUTE_PATH");
  }
  if (pathFlavor === "win32") validateWindowsPath(value);
}

function comparisonValue(value, pathFlavor) {
  return pathFlavor === "win32" ? value.toLowerCase() : value;
}

function isContained(root, candidate, pathFlavor) {
  const implementation = pathImplementation(pathFlavor);
  const relative = implementation.relative(root, candidate);
  if (relative === "") return true;
  if (implementation.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${implementation.sep}`);
}

function normalizePolicyPath(value, root, pathFlavor) {
  const implementation = pathImplementation(pathFlavor);
  const normalizedSeparators = separatorsForFlavor(value, pathFlavor);
  validatePathString(normalizedSeparators, pathFlavor);
  return implementation.normalize(
    implementation.isAbsolute(normalizedSeparators)
      ? normalizedSeparators
      : implementation.resolve(root, normalizedSeparators),
  );
}

function targetRelationship(candidate, target, pathFlavor) {
  if (!target) return undefined;
  const comparedCandidate = comparisonValue(candidate, pathFlavor);
  const comparedTarget = comparisonValue(target, pathFlavor);
  if (comparedCandidate === comparedTarget) return "configured-database";
  const targetPrefix = candidate.slice(0, target.length);
  const targetSuffix = candidate.slice(target.length).toLowerCase();
  if (
    comparisonValue(targetPrefix, pathFlavor) === comparedTarget &&
    SQLITE_SIDECARS.includes(targetSuffix)
  ) {
    return "configured-sidecar";
  }
  return undefined;
}

function runtimeRelationship(candidate, runtimeDirectories, pathFlavor) {
  return runtimeDirectories.some((directory) =>
    isContained(directory, candidate, pathFlavor),
  );
}

function forbidden(policyClass) {
  return Object.freeze({ status: "forbidden", policyClass });
}

/**
 * Construct a pure, cross-platform path policy. This function performs no
 * filesystem or environment access; callers supply every runtime boundary.
 */
export function createBuildPrivacyPolicy({
  projectRoot,
  configuredDatabasePath,
  runtimeDirectories = [],
  requiredTelemetryPreload = "scripts/next-telemetry-disabled.cjs",
}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw privacyPathError("ERR_BUILD_PRIVACY_INVALID_PATH");
  }
  const pathFlavor = inferPathFlavor(projectRoot);
  const implementation = pathImplementation(pathFlavor);
  const rootSeparators = separatorsForFlavor(projectRoot, pathFlavor);
  validatePathString(rootSeparators, pathFlavor);
  if (!implementation.isAbsolute(rootSeparators)) {
    throw privacyPathError("ERR_BUILD_PRIVACY_INVALID_PATH");
  }
  const normalizedProjectRoot = implementation.normalize(rootSeparators);
  const normalizedConfiguredTarget =
    configuredDatabasePath === undefined
      ? undefined
      : normalizePolicyPath(
          configuredDatabasePath,
          normalizedProjectRoot,
          pathFlavor,
        );
  const normalizedRuntimeDirectories = runtimeDirectories.map((directory) =>
    normalizePolicyPath(directory, normalizedProjectRoot, pathFlavor),
  );
  const telemetryPreload = separatorsForFlavor(
    requiredTelemetryPreload,
    pathFlavor,
  );
  validatePathString(telemetryPreload, pathFlavor);

  return Object.freeze({
    pathFlavor,
    projectRoot: normalizedProjectRoot,
    configuredDatabasePath: normalizedConfiguredTarget,
    runtimeDirectories: Object.freeze(normalizedRuntimeDirectories),
    requiredTelemetryPreload: telemetryPreload,
  });
}

/** Resolve one NFT entry relative to the manifest that contains it. */
export function resolveManifestEntry({ manifestPath, entry, pathFlavor }) {
  const implementation = pathImplementation(pathFlavor);
  const normalizedManifest = separatorsForFlavor(manifestPath, pathFlavor);
  const normalizedEntry = separatorsForFlavor(entry, pathFlavor);
  validatePathString(normalizedManifest, pathFlavor);
  validatePathString(normalizedEntry, pathFlavor);
  if (!implementation.isAbsolute(normalizedManifest)) {
    throw privacyPathError("ERR_BUILD_PRIVACY_INVALID_PATH");
  }
  return implementation.normalize(
    implementation.resolve(implementation.dirname(normalizedManifest), normalizedEntry),
  );
}

/** Classify a normalized build path without touching the filesystem. */
export function classifyBuildPath({
  policy,
  absolutePath,
  projectRelativePath,
  boundary,
}) {
  if (boundary !== "trace" && boundary !== "standalone") {
    return forbidden("invalid-path");
  }
  const { pathFlavor } = policy;
  const implementation = pathImplementation(pathFlavor);
  let candidate;
  try {
    const normalized = separatorsForFlavor(absolutePath, pathFlavor);
    validatePathString(normalized, pathFlavor);
    if (!implementation.isAbsolute(normalized)) return forbidden("invalid-path");
    candidate = implementation.normalize(normalized);
  } catch (error) {
    if (error?.code === "ERR_BUILD_PRIVACY_FOREIGN_ABSOLUTE_PATH") {
      return forbidden("foreign-absolute-path");
    }
    return forbidden("invalid-path");
  }

  const targetClass = targetRelationship(
    candidate,
    policy.configuredDatabasePath,
    pathFlavor,
  );
  if (targetClass) return forbidden(targetClass);
  if (isContained(policy.projectRoot, candidate, pathFlavor)) {
    const projectRelative = implementation
      .relative(policy.projectRoot, candidate)
      .replaceAll("\\", "/");
    if (projectRelative.split("/", 1)[0]?.toLowerCase() === "data") {
      return forbidden("repository-data");
    }
  }
  if (runtimeRelationship(candidate, policy.runtimeDirectories, pathFlavor)) {
    return forbidden("runtime-directory");
  }
  if (!isContained(policy.projectRoot, candidate, pathFlavor)) {
    return forbidden("path-escape");
  }

  const derivedRelative = implementation.relative(policy.projectRoot, candidate);
  const suppliedRelative =
    typeof projectRelativePath === "string"
      ? separatorsForFlavor(projectRelativePath, pathFlavor)
      : derivedRelative;
  try {
    validatePathString(suppliedRelative || ".", pathFlavor);
  } catch {
    return forbidden("invalid-path");
  }
  const relative = derivedRelative.replaceAll("\\", "/");
  const components = relative.split("/").filter(Boolean);
  const lowerComponents = components.map((component) => component.toLowerCase());
  const lowerRelative = lowerComponents.join("/");
  const basename = lowerComponents.at(-1) ?? "";

  if (basename.startsWith(".env")) return forbidden("private-environment");
  if (
    SQLITE_EXTENSIONS.has(path.posix.extname(basename)) ||
    SQLITE_SIDECARS.some((suffix) => basename.endsWith(suffix))
  ) {
    return forbidden("sqlite-runtime");
  }
  if (lowerComponents[0] === "data") return forbidden("repository-data");
  if (lowerComponents[0] === "imports" || lowerComponents[0] === "backups") {
    return forbidden("runtime-directory");
  }

  const inDependency = lowerComponents[0] === "node_modules";
  if (!inDependency) {
    if (
      lowerRelative === "src/test" ||
      lowerRelative.startsWith("src/test/") ||
      (lowerComponents[0] === "src" && /(?:^|\.)test\.[^.]+$/i.test(basename)) ||
      /^(?:vitest|playwright|jest)\.config\./i.test(basename)
    ) {
      return forbidden("project-test");
    }
    if (lowerComponents[0] === "deploy") return forbidden("deploy-file");
    if (
      components.length === 1 &&
      (ROOT_DOCUMENTATION.has(basename) ||
        /^implementation.*\.md$/i.test(basename))
    ) {
      return forbidden("project-documentation");
    }
    if (lowerComponents[0] === "scripts") {
      const allowedPreload = policy.requiredTelemetryPreload.replaceAll("\\", "/");
      const exactPreload =
        pathFlavor === "win32"
          ? lowerRelative === allowedPreload.toLowerCase()
          : relative === allowedPreload;
      if (lowerRelative !== "scripts" && !exactPreload) {
        return forbidden("operator-script");
      }
    }
  }

  return Object.freeze({ status: "safe", projectRelativePath: relative });
}
