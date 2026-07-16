import { constants, accessSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveInstalledPackageBin } from "./run-with-temp-db.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TEMPLATE_DIRECTORY = path.join(PROJECT_ROOT, "deploy");
const UNIT_FILES = Object.freeze([
  "finance.service",
  "finance-backup.service",
  "finance-backup.timer",
]);
const SERVICE_FILES = Object.freeze(["finance.service", "finance-backup.service"]);
const TOKENS = Object.freeze({
  nodeExecutable: "@@NODE_EXECUTABLE@@",
  nodeBinDirectory: "@@NODE_BIN_DIRECTORY@@",
  projectRoot: "@@PROJECT_ROOT@@",
  serviceUser: "@@SERVICE_USER@@",
  nextCli: "@@NEXT_CLI_JS@@",
  tsxCli: "@@TSX_CLI_MJS@@",
  telemetryPreload: "@@TELEMETRY_PRELOAD_CJS@@",
  servicePreflight: "@@SERVICE_PREFLIGHT_TS@@",
  backupScript: "@@BACKUP_SCRIPT_TS@@",
});
const REQUIRED_SERVICE_TOKENS = Object.freeze({
  "finance.service": Object.freeze([
    TOKENS.nodeExecutable,
    TOKENS.nodeBinDirectory,
    TOKENS.projectRoot,
    TOKENS.serviceUser,
    TOKENS.nextCli,
    TOKENS.tsxCli,
    TOKENS.telemetryPreload,
    TOKENS.servicePreflight,
  ]),
  "finance-backup.service": Object.freeze([
    TOKENS.nodeExecutable,
    TOKENS.nodeBinDirectory,
    TOKENS.projectRoot,
    TOKENS.serviceUser,
    TOKENS.tsxCli,
    TOKENS.servicePreflight,
    TOKENS.backupScript,
  ]),
});
const TOKEN_PATTERN = /@@[A-Z0-9_]+@@/g;
const SAFE_SYSTEMD_PATH = /^[A-Za-z0-9_./@+=,-]+$/;
const SAFE_SYSTEMD_USER = /^[a-z_][a-z0-9_-]{0,30}$/;
const SYSTEM_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin";

function isNodeError(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function assertSafeAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new Error(`${label} must be a normalized absolute path.`);
  }
  if (!SAFE_SYSTEMD_PATH.test(value)) {
    throw new Error(
      `${label} contains whitespace, controls, quoting, expansion, or other unsupported systemd characters.`,
    );
  }
}

function assertFile(value, label, mode) {
  assertSafeAbsolutePath(value, label);
  let stats;
  try {
    stats = statSync(value);
    accessSync(value, mode);
  } catch {
    throw new Error(`${label} must identify an accessible file.`);
  }
  if (!stats.isFile()) throw new Error(`${label} must identify a regular file.`);
}

function assertContainedCanonicalFile(value, projectRoot, label) {
  assertFile(value, label, constants.R_OK);
  if (!isWithin(projectRoot, value) || realpathSync(value) !== value) {
    throw new Error(`${label} must be a canonical file inside the project.`);
  }
}

export function parseMinimumNodeVersion(requirement) {
  const match = /^>=(\d+)\.(\d+)(?:\.(\d+))?$/.exec(requirement);
  if (!match) {
    throw new Error(`Unsupported package.json Node engine requirement: ${requirement}`);
  }
  return match.slice(1).map((part) => Number(part ?? "0"));
}

export function parseNodeVersion(output) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(output.trim());
  if (!match) throw new Error("The selected Node executable returned an invalid version.");
  return match.slice(1).map(Number);
}

export function satisfiesMinimumNodeVersion(version, minimum) {
  for (let index = 0; index < 3; index += 1) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
}

function runRuntimeCommand(
  runCommand,
  executable,
  argumentsList,
  environment,
  label,
  cwd,
) {
  const result = runCommand(executable, argumentsList, {
    cwd,
    encoding: "utf8",
    env: environment,
    maxBuffer: 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    throw new Error(`${label} failed under the selected runtime.`);
  }
  return result.stdout.trim();
}

function installedPackageMetadata(packageName, projectRoot) {
  const require = createRequire(path.join(projectRoot, "package.json"));
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  assertContainedCanonicalFile(
    packageJsonPath,
    projectRoot,
    `The installed ${packageName} package metadata`,
  );
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    throw new Error(`The installed ${packageName} package metadata is invalid.`);
  }
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error(`The installed ${packageName} package has no valid version.`);
  }
  return Object.freeze({ packageJsonPath, version: metadata.version });
}

export function assertNoLocalNodeShadow(projectRoot = PROJECT_ROOT) {
  const localNode = path.join(projectRoot, "node_modules", ".bin", "node");
  try {
    lstatSync(localNode);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw new Error("Could not inspect the local dependency executable directory.");
  }
  throw new Error(
    "node_modules/.bin/node would shadow the selected Node inside npm lifecycle scripts.",
  );
}

function inspectTemplates(templateDirectory) {
  const contents = new Map();
  for (const filename of UNIT_FILES) {
    const source = readFileSync(path.join(templateDirectory, filename), "utf8");
    if (source.includes("/usr/bin/npm")) {
      throw new Error(`${filename} retains the forbidden /usr/bin/npm assumption.`);
    }
    const tokens = source.match(TOKEN_PATTERN) ?? [];
    for (const token of tokens) {
      if (!Object.values(TOKENS).includes(token)) {
        throw new Error(`${filename} contains an unknown systemd template token.`);
      }
    }
    if (SERVICE_FILES.includes(filename)) {
      for (const token of REQUIRED_SERVICE_TOKENS[filename]) {
        if (!tokens.includes(token)) {
          throw new Error(`${filename} is missing a required runtime token.`);
        }
      }
    } else if (tokens.length > 0) {
      throw new Error(`${filename} must not contain inert runtime tokens.`);
    }
    contents.set(filename, source);
  }
  return contents;
}

function resolveOutputDirectory(outputDirectory, templateDirectory) {
  if (typeof outputDirectory !== "string" || !path.isAbsolute(outputDirectory)) {
    throw new Error("The systemd staging directory must be an absolute path.");
  }
  const normalized = path.resolve(outputDirectory);
  if (normalized !== outputDirectory) {
    throw new Error("The systemd staging directory must be normalized.");
  }

  const parent = realpathSync(path.dirname(normalized));
  const effectiveOutput = path.join(parent, path.basename(normalized));
  const effectiveTemplate = realpathSync(templateDirectory);
  if (
    isWithin(effectiveTemplate, effectiveOutput) ||
    isWithin("/etc/systemd/system", effectiveOutput)
  ) {
    throw new Error("Render units only into a separate staging directory.");
  }
  try {
    lstatSync(effectiveOutput);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return effectiveOutput;
    throw new Error("Could not inspect the systemd staging directory.");
  }
  throw new Error("The systemd staging directory must not already exist.");
}

export function renderSystemdUnits({
  nodeExecutable,
  npmCli,
  serviceUser,
  outputDirectory,
  projectRoot = PROJECT_ROOT,
  templateDirectory = DEFAULT_TEMPLATE_DIRECTORY,
  runCommand = spawnSync,
}) {
  assertSafeAbsolutePath(projectRoot, "The project root");
  if (realpathSync(projectRoot) !== projectRoot) {
    throw new Error("The project root must be canonical.");
  }
  assertFile(nodeExecutable, "The selected Node executable", constants.X_OK);
  if (path.basename(nodeExecutable) !== "node") {
    throw new Error('The selected Node executable must use the stable basename "node".');
  }
  assertFile(npmCli, "The selected npm CLI", constants.R_OK);
  if (
    typeof serviceUser !== "string" ||
    !SAFE_SYSTEMD_USER.test(serviceUser) ||
    serviceUser === "root"
  ) {
    throw new Error("The service user must be a conservative non-root account name.");
  }

  if (realpathSync(nodeExecutable) !== realpathSync(process.execPath)) {
    throw new Error("Run the renderer through the same Node executable selected for systemd.");
  }

  const nodeBinDirectory = path.dirname(nodeExecutable);
  assertSafeAbsolutePath(nodeBinDirectory, "The selected Node bin directory");
  assertNoLocalNodeShadow(projectRoot);

  const nextCli = resolveInstalledPackageBin("next", "next", {
    repositoryRoot: projectRoot,
  });
  const tsxCli = resolveInstalledPackageBin("tsx", "tsx", {
    repositoryRoot: projectRoot,
  });
  const telemetryPreload = path.join(projectRoot, "scripts", "next-telemetry-disabled.cjs");
  const servicePreflight = path.join(projectRoot, "scripts", "service-preflight.ts");
  const backupScript = path.join(projectRoot, "scripts", "backup-db.ts");
  for (const [target, label] of [
    [nextCli, "The installed Next CLI"],
    [tsxCli, "The installed tsx CLI"],
    [telemetryPreload, "The telemetry preload"],
    [servicePreflight, "The service preflight"],
    [backupScript, "The backup entrypoint"],
  ]) {
    assertContainedCanonicalFile(target, projectRoot, label);
  }

  const nextMetadata = installedPackageMetadata("next", projectRoot);
  const tsxMetadata = installedPackageMetadata("tsx", projectRoot);

  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const requirement = packageJson.engines?.node;
  if (typeof requirement !== "string") {
    throw new Error("package.json must declare the supported Node engine.");
  }
  if (packageJson.dependencies?.next !== nextMetadata.version) {
    throw new Error("Installed Next version does not match the exact package dependency.");
  }

  const environment = Object.freeze({
    HOME: os.tmpdir(),
    LANG: "C",
    LC_ALL: "C",
    PATH: `${nodeBinDirectory}:${SYSTEM_PATH}`,
  });
  const nodeVersionText = runRuntimeCommand(
    runCommand,
    nodeExecutable,
    ["--version"],
    environment,
    "The selected Node version check",
    projectRoot,
  );
  const nodeVersion = parseNodeVersion(nodeVersionText);
  const minimum = parseMinimumNodeVersion(requirement);
  if (!satisfiesMinimumNodeVersion(nodeVersion, minimum)) {
    throw new Error(`The selected Node executable does not satisfy ${requirement}.`);
  }

  const npmVersion = runRuntimeCommand(
    runCommand,
    nodeExecutable,
    [npmCli, "--version"],
    environment,
    "The selected npm CLI version check",
    projectRoot,
  );
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(npmVersion)) {
    throw new Error("The selected npm CLI returned an invalid version.");
  }

  const nextVersionOutput = runRuntimeCommand(
    runCommand,
    nodeExecutable,
    ["--require", telemetryPreload, nextCli, "--version"],
    environment,
    "The installed Next CLI version check",
    projectRoot,
  );
  if (nextVersionOutput !== `Next.js v${nextMetadata.version}`) {
    throw new Error("The installed Next CLI returned an unexpected version.");
  }
  const tsxVersionOutput = runRuntimeCommand(
    runCommand,
    nodeExecutable,
    [tsxCli, "--no-cache", "--version"],
    environment,
    "The installed tsx CLI version check",
    projectRoot,
  );
  if (tsxVersionOutput.split(/\r?\n/u)[0] !== `tsx v${tsxMetadata.version}`) {
    throw new Error("The installed tsx CLI returned an unexpected version.");
  }

  const templates = inspectTemplates(templateDirectory);
  const effectiveOutput = resolveOutputDirectory(outputDirectory, templateDirectory);
  const replacements = new Map([
    [TOKENS.nodeExecutable, nodeExecutable],
    [TOKENS.nodeBinDirectory, nodeBinDirectory],
    [TOKENS.projectRoot, projectRoot],
    [TOKENS.serviceUser, serviceUser],
    [TOKENS.nextCli, nextCli],
    [TOKENS.tsxCli, tsxCli],
    [TOKENS.telemetryPreload, telemetryPreload],
    [TOKENS.servicePreflight, servicePreflight],
    [TOKENS.backupScript, backupScript],
  ]);
  const rendered = new Map();
  for (const [filename, template] of templates) {
    let source = template;
    for (const [token, replacement] of replacements) {
      source = source.replaceAll(token, replacement);
    }
    if (TOKEN_PATTERN.test(source)) {
      TOKEN_PATTERN.lastIndex = 0;
      throw new Error(`${filename} contains an unresolved systemd template token.`);
    }
    TOKEN_PATTERN.lastIndex = 0;
    rendered.set(filename, source);
  }

  let ownsOutputDirectory = false;
  try {
    mkdirSync(effectiveOutput, { mode: 0o700 });
    ownsOutputDirectory = true;
    for (const [filename, source] of rendered) {
      writeFileSync(path.join(effectiveOutput, filename), source, {
        encoding: "utf8",
        mode: 0o644,
        flag: "wx",
      });
    }
  } catch (error) {
    if (ownsOutputDirectory) rmSync(effectiveOutput, { force: true, recursive: true });
    throw error;
  }

  return Object.freeze({
    nodeVersion: nodeVersionText,
    npmVersion,
    nextVersion: nextMetadata.version,
    tsxVersion: tsxMetadata.version,
    serviceUser,
    nextCli,
    tsxCli,
    outputDirectory: effectiveOutput,
    unitFiles: UNIT_FILES,
  });
}

export function parseRenderArguments(argv) {
  if (argv.length !== 8) {
    throw new Error(
      "Usage: node scripts/render-systemd-units.mjs --node <absolute-path> --npm-cli <absolute-path> --service-user <account> --output <absolute-staging-directory>",
    );
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (
      !["--node", "--npm-cli", "--service-user", "--output"].includes(option) ||
      values.has(option)
    ) {
      throw new Error("Unknown or duplicate systemd renderer option.");
    }
    values.set(option, value);
  }
  if (
    !["--node", "--npm-cli", "--service-user", "--output"].every((option) =>
      values.has(option),
    )
  ) {
    throw new Error(
      "The systemd renderer requires node, npm CLI, service user, and output paths.",
    );
  }
  return Object.freeze({
    nodeExecutable: values.get("--node"),
    npmCli: values.get("--npm-cli"),
    serviceUser: values.get("--service-user"),
    outputDirectory: values.get("--output"),
  });
}

function main() {
  try {
    const result = renderSystemdUnits(parseRenderArguments(process.argv.slice(2)));
    console.log(
      `Validated ${result.nodeVersion} with npm ${result.npmVersion}, Next ${result.nextVersion}, and tsx ${result.tsxVersion}.`,
    );
    console.log(`Rendered service account: ${result.serviceUser}.`);
    console.log(`Rendered ${result.unitFiles.length} staged units to ${result.outputDirectory}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Systemd unit rendering failed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
