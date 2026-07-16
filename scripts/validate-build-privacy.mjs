#!/usr/bin/env node
import Database from "better-sqlite3";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatPrivacyReport,
  inspectStandaloneTree,
  runPrivacyCheck,
} from "./check-build-privacy.mjs";
import { createBuildPrivacyPolicy } from "./build-privacy-policy.mjs";
import { runServerSmoke } from "./smoke-server.mjs";
import { runMode } from "./run-with-temp-db.mjs";

const ROOT_FILES = Object.freeze([
  "next-env.d.ts",
  "next.config.ts",
  "package.json",
  "package-lock.json",
  "postcss.config.mjs",
  "tsconfig.json",
]);
const ROOT_DIRECTORIES = Object.freeze([
  "drizzle",
  "node_modules",
  "public",
  "scripts",
  "src",
]);
const MAX_CAPTURED_OUTPUT = 256 * 1024;
const BUILT_TEST_ORIGIN = "https://built-origin.invalid";
const CHANGED_RUNTIME_ORIGIN = "https://changed-origin.invalid";
const sourceRepositoryRoot = realpathSync.native(
  path.resolve(import.meta.dirname, ".."),
);

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function validateCopySource(repositoryRoot, source) {
  const metadata = lstatSync(source);
  if (metadata.isSymbolicLink()) {
    if (path.isAbsolute(readlinkSync(source))) {
      throw new Error("Sanitized copy refuses absolute source symlinks.");
    }
    const target = realpathSync.native(source);
    if (!isContained(repositoryRoot, target)) {
      throw new Error("Sanitized copy refuses escaping source symlinks.");
    }
    return;
  }
  if (!metadata.isDirectory()) return;
  for (const entry of readdirSync(source)) {
    if (entry.toLowerCase().startsWith(".env")) {
      throw new Error("Sanitized copy refuses environment files.");
    }
    validateCopySource(repositoryRoot, path.join(source, entry));
  }
}

export function copySanitizedWorkspace({ repositoryRoot, workspaceRoot }) {
  mkdirSync(workspaceRoot, { recursive: true });
  for (const relative of [...ROOT_FILES, ...ROOT_DIRECTORIES]) {
    const source = path.join(repositoryRoot, relative);
    validateCopySource(repositoryRoot, source);
    cpSync(source, path.join(workspaceRoot, relative), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}

function syntheticSentinels(workspaceRoot) {
  const paths = [
    "data/finance.db",
    "data/finance.db-wal",
    "data/finance.db-shm",
    "data/imports/statement.csv",
    "data/backups/archive.custom",
  ];
  for (const relative of paths) {
    const absolute = path.join(workspaceRoot, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, `synthetic-build-privacy-sentinel:${relative}\n`);
  }
  return paths;
}

function fileEvidence(workspaceRoot, relativePaths) {
  return new Map(
    relativePaths.map((relative) => {
      const absolute = path.join(workspaceRoot, relative);
      const metadata = statSync(absolute);
      return [
        relative,
        Object.freeze({
          digest: createHash("sha256").update(readFileSync(absolute)).digest("hex"),
          size: metadata.size,
          mode: metadata.mode,
          mtimeMs: metadata.mtimeMs,
        }),
      ];
    }),
  );
}

function assertEvidenceUnchanged(workspaceRoot, expected) {
  const actual = fileEvidence(workspaceRoot, [...expected.keys()]);
  for (const [relative, evidence] of expected) {
    if (JSON.stringify(actual.get(relative)) !== JSON.stringify(evidence)) {
      throw new Error("Synthetic runtime sentinel changed during validation.");
    }
  }
}

function sanitizedEnvironment(validationRoot) {
  const cleanHome = path.join(validationRoot, "home");
  const cleanTemp = path.join(validationRoot, "tmp");
  const cleanCache = path.join(validationRoot, "xdg-cache");
  const cleanConfig = path.join(validationRoot, "xdg-config");
  for (const directory of [cleanHome, cleanTemp, cleanCache, cleanConfig]) {
    mkdirSync(directory, { recursive: true });
  }
  const environment = {
    HOME: cleanHome,
    TMPDIR: cleanTemp,
    XDG_CACHE_HOME: cleanCache,
    XDG_CONFIG_HOME: cleanConfig,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_TELEMETRY_DEBUG: "1",
  };
  for (const name of ["LANG", "LC_ALL", "PATH", "TZ"]) {
    if (typeof process.env[name] === "string") environment[name] = process.env[name];
  }
  return { environment, temporaryDirectory: cleanTemp };
}

function capturingSpawn(capture) {
  return (executable, args, options) => {
    const child = spawn(executable, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (chunk) => {
      capture.output += chunk.toString("utf8");
      if (capture.output.length > MAX_CAPTURED_OUTPUT) {
        capture.output = capture.output.slice(-MAX_CAPTURED_OUTPUT);
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    return child;
  };
}

function assertBuildResult(result, capture) {
  if (result.postSuccessError?.report) {
    throw new Error(formatPrivacyReport(result.postSuccessError.report));
  }
  if (
    result.code !== 0 ||
    result.signal !== null ||
    result.requestedSignal !== null ||
    result.spawnError !== null ||
    result.cleanupError !== null ||
    result.postSuccessError !== null
  ) {
    throw new Error("Sanitized Next build or privacy gate failed.");
  }
  if (
    /inferred your workspace root|multiple lockfiles detected|turbopack.*root/i.test(
      capture.output,
    )
  ) {
    throw new Error("Next reported an inferred-root warning.");
  }
  if (/collects completely anonymous telemetry|\[telemetry\]/i.test(capture.output)) {
    throw new Error("Next emitted telemetry output despite the intrinsic opt-out.");
  }
}

async function runSanitizedBuild(workspaceRoot, environment) {
  const capture = { output: "" };
  const result = await runMode("build", [], {
    repositoryRoot: workspaceRoot,
    environment,
    onTarget() {},
    spawnImplementation: capturingSpawn(capture),
  });
  assertBuildResult(result, capture);
  const report = runPrivacyCheck({ projectRoot: workspaceRoot, environment });
  if (!report.ok) throw new Error(formatPrivacyReport(report));
}

function runSanitizedServicePreflight(
  workspaceRoot,
  environment,
  temporaryDirectory,
) {
  const serviceRuntime = path.join(temporaryDirectory, "service-preflight-runtime");
  mkdirSync(serviceRuntime, { mode: 0o700 });
  const tsxCli = path.join(workspaceRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const preflight = path.join(workspaceRoot, "scripts", "service-preflight.ts");
  const nodeArguments = [tsxCli, "--no-cache", preflight, "app"];
  const executable = process.platform === "linux" ? "/usr/bin/setpriv" : process.execPath;
  const argumentsList =
    process.platform === "linux"
      ? ["--no-new-privs", process.execPath, ...nodeArguments]
      : nodeArguments;
  const previousUmask =
    process.platform === "win32" ? undefined : process.umask(0o077);
  let result;
  try {
    result = spawnSync(executable, argumentsList, {
      cwd: workspaceRoot,
      env: {
        ...environment,
        DB_FILE_NAME: path.join(serviceRuntime, "ledger.sqlite3"),
        MONEYBAGS_REPOSITORY_ROOT: workspaceRoot,
        NODE_ENV: "production",
      },
      maxBuffer: MAX_CAPTURED_OUTPUT,
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } finally {
    if (previousUmask !== undefined) process.umask(previousUmask);
  }
  if (result.error || result.status !== 0 || result.signal !== null) {
    throw new Error("Sanitized direct service preflight failed.");
  }
  if (readdirSync(serviceRuntime).length !== 0) {
    throw new Error("Sanitized direct service preflight created a database artifact.");
  }
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

const EXPECTED_SECURITY_HEADERS = Object.freeze({
  "content-security-policy": "frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

async function fetchForResponsePolicy(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  timer.unref();
  try {
    return await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function assertProductionResponsePolicy(response, label, expectedStatus, expectNoStore) {
  if (response.status !== expectedStatus) {
    throw new Error(`Production response policy ${label} returned an unexpected status.`);
  }
  for (const [name, expected] of Object.entries(EXPECTED_SECURITY_HEADERS)) {
    if (response.headers.get(name) !== expected) {
      throw new Error(`Production response policy ${label} is missing ${name}.`);
    }
  }
  if (expectNoStore && response.headers.get("cache-control") !== "no-store") {
    throw new Error(`Production response policy ${label} is cacheable.`);
  }
  if (response.headers.has("x-powered-by")) {
    throw new Error(`Production response policy ${label} disclosed x-powered-by.`);
  }
  if (response.headers.has("access-control-allow-origin")) {
    throw new Error(`Production response policy ${label} added permissive CORS.`);
  }
}

function insertFreshnessSentinel(databasePath) {
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    const now = Date.now();
    database
      .prepare(
        `INSERT INTO accounts (
          id, name, type, institution, currency, opening_balance_cents, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "synthetic-production-freshness-account",
        "Synthetic production freshness account",
        "CHECKING",
        null,
        "USD",
        0,
        now,
        now,
      );
  } finally {
    database.close();
  }
}

async function verifyFinancialResponseFreshness({ baseUrl, databasePath }) {
  const url = `${baseUrl}/api/accounts`;
  const before = await fetchForResponsePolicy(url);
  try {
    assertProductionResponsePolicy(before, "accounts-before-mutation", 200, true);
    const body = await before.json();
    if (
      !Array.isArray(body.accounts) ||
      body.accounts.some((account) => account?.id === "synthetic-production-freshness-account")
    ) {
      throw new Error("Production response freshness precondition failed.");
    }
  } finally {
    if (!before.bodyUsed) await before.body?.cancel();
  }

  insertFreshnessSentinel(databasePath);

  const after = await fetchForResponsePolicy(url);
  try {
    assertProductionResponsePolicy(after, "accounts-after-mutation", 200, true);
    const body = await after.json();
    if (
      !Array.isArray(body.accounts) ||
      !body.accounts.some(
        (account) => account?.id === "synthetic-production-freshness-account",
      )
    ) {
      throw new Error("Production financial response was stale after synthetic mutation.");
    }
  } finally {
    if (!after.bodyUsed) await after.body?.cancel();
  }
}

async function verifyProductionResponsePolicy({ baseUrl, databasePath }) {
  const requests = [
    ["root", `${baseUrl}/`, undefined, 200, false],
    ["health", `${baseUrl}/api/health`, undefined, 200, true],
    ["accounts", `${baseUrl}/api/accounts`, undefined, 200, true],
    ["transactions", `${baseUrl}/api/transactions`, undefined, 200, true],
    ["spending", `${baseUrl}/api/summary/spending`, undefined, 200, true],
    ["net-worth", `${baseUrl}/api/summary/net-worth`, undefined, 200, true],
    ["export", `${baseUrl}/api/export`, undefined, 200, true],
    ["not-found", `${baseUrl}/synthetic-not-found`, undefined, 404, false],
    ["static", `${baseUrl}/icon-192.png`, undefined, 200, false],
    [
      "built-origin-acceptance",
      `${baseUrl}/api/import`,
      {
        method: "POST",
        headers: { origin: BUILT_TEST_ORIGIN },
        body: new URLSearchParams({ accountId: "" }),
      },
      415,
      true,
    ],
    [
      "changed-runtime-origin-rejection",
      `${baseUrl}/api/import`,
      { method: "POST", headers: { origin: CHANGED_RUNTIME_ORIGIN } },
      403,
      true,
    ],
  ];

  for (const [label, url, init, expectedStatus, expectNoStore] of requests) {
    const response = await fetchForResponsePolicy(url, init);
    try {
      assertProductionResponsePolicy(response, label, expectedStatus, expectNoStore);
    } finally {
      await response.body?.cancel();
    }
  }

  await verifyFinancialResponseFreshness({ baseUrl, databasePath });
}

async function smokeOrdinaryBuild(workspaceRoot, environment, temporaryDirectory) {
  const port = await availablePort();
  const result = await runServerSmoke("start", {
    repositoryRoot: workspaceRoot,
    environment: {
      ...environment,
      EXTRA_ALLOWED_ORIGINS: CHANGED_RUNTIME_ORIGIN,
      MONEYBAGS_TRUST_LOOPBACK_PROXY: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
    },
    temporaryDirectory,
    port,
    nodeArguments: [
      "--require",
      path.join(workspaceRoot, "scripts", "next-telemetry-disabled.cjs"),
      path.join(workspaceRoot, "node_modules", "next", "dist", "bin", "next"),
      "start",
      "-p",
      String(port),
      "-H",
      "127.0.0.1",
    ],
    stdio: "ignore",
    verifyHealthyServer: verifyProductionResponsePolicy,
    log() {},
  });
  if (result.code !== 0 || result.signal !== undefined || result.cleanupError) {
    throw new Error("Sanitized ordinary production smoke failed.");
  }
}

function enableStandaloneFixture(workspaceRoot) {
  const configPath = path.join(workspaceRoot, "next.config.ts");
  const config = readFileSync(configPath, "utf8");
  const marker = "const nextConfig: NextConfig = {\n";
  if (!config.includes(marker)) {
    throw new Error("Standalone fixture could not apply its config overlay.");
  }
  writeFileSync(
    configPath,
    config.replace(marker, `${marker}  output: "standalone",\n`),
  );
}

function inspectSanitizedStandalone(workspaceRoot, environment) {
  const standaloneRoot = path.join(workspaceRoot, ".next", "standalone");
  const configured = environment.DB_FILE_NAME ?? path.join("data", "finance.db");
  const configuredDatabasePath = path.isAbsolute(configured)
    ? configured
    : path.resolve(standaloneRoot, configured);
  const policy = createBuildPrivacyPolicy({
    projectRoot: standaloneRoot,
    configuredDatabasePath,
    runtimeDirectories: ["data", "imports", "backups"],
  });
  const report = inspectStandaloneTree({
    projectRoot: workspaceRoot,
    standaloneRoot,
    policy,
  });
  if (!report.ok) throw new Error(formatPrivacyReport(report));
  return standaloneRoot;
}

async function smokeStandaloneBuild(
  standaloneRoot,
  environment,
  temporaryDirectory,
) {
  const port = await availablePort();
  const result = await runServerSmoke("start", {
    repositoryRoot: standaloneRoot,
    environment: {
      ...environment,
      EXTRA_ALLOWED_ORIGINS: CHANGED_RUNTIME_ORIGIN,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
    },
    temporaryDirectory,
    port,
    nodeArguments: [
      "--require",
      path.join(standaloneRoot, "scripts", "next-telemetry-disabled.cjs"),
      path.join(standaloneRoot, "server.js"),
    ],
    stdio: "ignore",
    verifyHealthyServer: verifyProductionResponsePolicy,
    log() {},
  });
  if (result.code !== 0 || result.signal !== undefined || result.cleanupError) {
    throw new Error("Sanitized standalone production smoke failed.");
  }
}

export async function validateSanitizedBuildPrivacy({
  repositoryRoot = sourceRepositoryRoot,
  temporaryDirectory = tmpdir(),
  onStatus = () => {},
}) {
  const validationRoot = mkdtempSync(
    path.join(realpathSync.native(temporaryDirectory), "moneybags-build-validation-"),
  );
  const workspaceRoot = path.join(validationRoot, "workspace");
  let primaryError;
  try {
    onStatus("copying-sanitized-workspace");
    copySanitizedWorkspace({ repositoryRoot, workspaceRoot });
    const sentinels = syntheticSentinels(workspaceRoot);
    const expectedEvidence = fileEvidence(workspaceRoot, sentinels);
    const { environment, temporaryDirectory: runtimeTemporaryDirectory } =
      sanitizedEnvironment(validationRoot);
    const buildEnvironment = {
      ...environment,
      EXTRA_ALLOWED_ORIGINS: BUILT_TEST_ORIGIN,
    };

    onStatus("building-ordinary-output");
    await runSanitizedBuild(workspaceRoot, buildEnvironment);
    assertEvidenceUnchanged(workspaceRoot, expectedEvidence);
    onStatus("preflighting-ordinary-output");
    runSanitizedServicePreflight(
      workspaceRoot,
      buildEnvironment,
      runtimeTemporaryDirectory,
    );
    assertEvidenceUnchanged(workspaceRoot, expectedEvidence);
    onStatus("smoking-ordinary-output");
    await smokeOrdinaryBuild(
      workspaceRoot,
      buildEnvironment,
      runtimeTemporaryDirectory,
    );
    assertEvidenceUnchanged(workspaceRoot, expectedEvidence);

    onStatus("building-standalone-output");
    rmSync(path.join(workspaceRoot, ".next"), { recursive: true, force: true });
    enableStandaloneFixture(workspaceRoot);
    await runSanitizedBuild(workspaceRoot, buildEnvironment);
    const standaloneRoot = inspectSanitizedStandalone(
      workspaceRoot,
      buildEnvironment,
    );
    assertEvidenceUnchanged(workspaceRoot, expectedEvidence);
    onStatus("smoking-standalone-output");
    await smokeStandaloneBuild(
      standaloneRoot,
      buildEnvironment,
      runtimeTemporaryDirectory,
    );
    assertEvidenceUnchanged(workspaceRoot, expectedEvidence);
    onStatus("passed");
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      rmSync(validationRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      if (primaryError) {
        throw new AggregateError(
          [primaryError, cleanupError],
          "Sanitized build validation and cleanup both failed.",
        );
      }
      throw cleanupError;
    }
  }
  if (primaryError) throw primaryError;
}

async function main() {
  try {
    await validateSanitizedBuildPrivacy({
      onStatus(status) {
        process.stderr.write(`build-privacy-validation: ${status}\n`);
      },
    });
  } catch {
    process.stderr.write("build-privacy-validation: failed\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
