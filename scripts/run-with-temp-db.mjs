#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPOSITORY_ROOT_ENV_NAME,
  TEMP_DB_ROOT_ENV_NAME,
  TEMP_DB_TOKEN_ENV_NAME,
  cleanupTemporaryDatabaseLease,
  createTemporaryDatabaseLease,
  listTemporaryDatabaseArtifacts,
} from "./temporary-db.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const SIGNAL_GRACE_MS = 5_000;

const MODES = Object.freeze({
  build: { packageName: "next", binName: "next", arguments: ["build"] },
  test: { packageName: "vitest", binName: "vitest", arguments: ["run"] },
  "test:watch": { packageName: "vitest", binName: "vitest", arguments: [] },
  lint: { packageName: "eslint", binName: "eslint", arguments: [] },
});

export function assertProcessTreeCleanupSupported(platform = process.platform) {
  if (platform === "win32") {
    const error = new Error(
      "Safe temporary-command process-tree cleanup is not available on native Windows; use WSL, Linux, or macOS.",
    );
    error.code = "ERR_MONEYBAGS_UNSUPPORTED_PLATFORM";
    throw error;
  }
}

export function resolveInstalledPackageBin(
  packageName,
  binName,
  { repositoryRoot = REPOSITORY_ROOT } = {},
) {
  const require = createRequire(path.join(repositoryRoot, "package.json"));
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const metadata = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const declaredBin =
    typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.[binName];
  if (typeof declaredBin !== "string" || declaredBin.length === 0) {
    throw new Error("Installed package metadata does not declare the required executable.");
  }
  const executable = path.resolve(path.dirname(packageJsonPath), declaredBin);
  if (!executable.startsWith(`${path.dirname(packageJsonPath)}${path.sep}`)) {
    throw new Error("Installed package metadata declares an invalid executable.");
  }
  return executable;
}

function signalProcessTree(child, signal) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessGroupExit(pid, graceMs) {
  if (pid === undefined) return;
  const deadline = Date.now() + graceMs;
  while (processGroupExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (processGroupExists(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
    const killDeadline = Date.now() + graceMs;
    while (processGroupExists(pid) && Date.now() < killDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  if (processGroupExists(pid)) {
    throw new Error("Child process group did not stop before database cleanup.");
  }
}

function waitForChild(child) {
  return new Promise((resolve) => {
    let spawnError = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => resolve({ code, signal, spawnError }));
  });
}

/**
 * Execute a resolved command under a temporary DB lease. This lower-level
 * helper exists so failure and signal cleanup can be tested without widening
 * the wrapper's strict public CLI modes.
 */
export async function runTemporaryDatabaseCommand({
  executable,
  args = [],
  repositoryRoot = REPOSITORY_ROOT,
  environment = process.env,
  lintMode = false,
  onTarget = () => {},
  spawnImplementation = spawn,
  signalSource = process,
  signalGraceMs = SIGNAL_GRACE_MS,
}) {
  assertProcessTreeCleanupSupported();
  let lease;
  let child;
  let result = { code: null, signal: null, spawnError: null };
  let requestedSignal = null;
  let escalationTimer = null;
  let treeError = null;
  let lintArtifact = false;
  let cleanupError = null;
  let primaryError = null;
  const forward = (signal) => {
    const firstSignal = requestedSignal === null;
    requestedSignal ??= signal;
    if (!child) return;
    try {
      signalProcessTree(child, firstSignal ? signal : "SIGKILL");
      if (escalationTimer === null) {
        escalationTimer = setTimeout(() => {
          try {
            signalProcessTree(child, "SIGKILL");
          } catch (error) {
            treeError ??= error;
          }
        }, signalGraceMs);
        escalationTimer.unref?.();
      }
    } catch (error) {
      treeError ??= error;
    }
  };
  const onSigint = () => forward("SIGINT");
  const onSigterm = () => forward("SIGTERM");
  signalSource.on("SIGINT", onSigint);
  signalSource.on("SIGTERM", onSigterm);

  try {
    lease = createTemporaryDatabaseLease({
      repositoryRoot,
      inheritedDatabaseFileName: environment.DB_FILE_NAME,
    });
    onTarget(lease.databasePath);
    if (requestedSignal === null) {
      try {
        child = spawnImplementation(executable, args, {
          cwd: repositoryRoot,
          env: {
            ...environment,
            DB_FILE_NAME: lease.databasePath,
            [REPOSITORY_ROOT_ENV_NAME]: lease.repositoryRoot,
            [TEMP_DB_ROOT_ENV_NAME]: lease.rootPath,
            [TEMP_DB_TOKEN_ENV_NAME]: lease.ownershipToken,
          },
          shell: false,
          stdio: "inherit",
          detached: true,
        });
      } catch (spawnError) {
        result = { code: null, signal: null, spawnError };
      }
      if (child !== undefined) {
        result = await waitForChild(child);
        if (escalationTimer !== null) clearTimeout(escalationTimer);
        try {
          await waitForProcessGroupExit(child.pid, signalGraceMs);
        } catch (error) {
          treeError ??= error;
        }
      }
    }
    if (lintMode) lintArtifact = listTemporaryDatabaseArtifacts(lease).length > 0;
  } catch (error) {
    primaryError = error;
  } finally {
    if (escalationTimer !== null) clearTimeout(escalationTimer);
    if (lease !== undefined) {
      if (treeError !== null) {
        cleanupError = treeError;
      } else {
        try {
          cleanupTemporaryDatabaseLease(lease);
        } catch (error) {
          cleanupError = error;
        }
      }
    }
    signalSource.off("SIGINT", onSigint);
    signalSource.off("SIGTERM", onSigterm);
  }

  if (primaryError !== null) {
    if (cleanupError !== null) {
      throw new AggregateError(
        [primaryError, cleanupError],
        "Temporary command and cleanup both failed.",
      );
    }
    throw primaryError;
  }
  return {
    ...result,
    requestedSignal,
    lintArtifact,
    cleanupError,
    rootPath: lease?.rootPath,
  };
}

export async function runMode(
  mode,
  forwardedArguments,
  {
    repositoryRoot = REPOSITORY_ROOT,
    environment = process.env,
    onTarget = () => {},
    spawnImplementation = spawn,
    signalSource = process,
    signalGraceMs = SIGNAL_GRACE_MS,
  } = {},
) {
  const configuration = MODES[mode];
  if (!configuration) throw new Error("Unsupported temporary database command mode.");
  const binPath = resolveInstalledPackageBin(
    configuration.packageName,
    configuration.binName,
    { repositoryRoot },
  );
  return runTemporaryDatabaseCommand({
    executable: process.execPath,
    args: [binPath, ...configuration.arguments, ...forwardedArguments],
    repositoryRoot,
    environment,
    lintMode: mode === "lint",
    onTarget,
    spawnImplementation,
    signalSource,
    signalGraceMs,
  });
}

function writeStatus(message) {
  process.stderr.write(`temporary-db status ${message}\n`);
}

function exitForResult(result) {
  if (result.cleanupError) {
    writeStatus("cleanup-failed");
    process.exitCode = 1;
    return;
  }
  if (result.spawnError) {
    writeStatus("spawn-failed");
    process.exitCode = 1;
    return;
  }
  if (result.lintArtifact) {
    writeStatus("lint-artifact-detected");
    process.exitCode = 1;
    return;
  }

  const signal = result.requestedSignal ?? result.signal;
  if (signal) {
    writeStatus(`clean signal=${signal}`);
    process.kill(process.pid, signal);
    return;
  }

  writeStatus(`clean exit=${result.code}`);
  process.exitCode = result.code ?? 1;
}

async function main() {
  const [mode, ...forwardedArguments] = process.argv.slice(2);
  if (!Object.hasOwn(MODES, mode)) {
    writeStatus("invalid-mode");
    process.exitCode = 2;
    return;
  }

  try {
    const result = await runMode(mode, forwardedArguments, {
      onTarget(databasePath) {
        process.stderr.write(`temporary-db target ${databasePath}\n`);
      },
    });
    exitForResult(result);
  } catch (error) {
    writeStatus(
      error?.code === "ERR_MONEYBAGS_UNSUPPORTED_PLATFORM"
        ? "unsupported-platform use-wsl-linux-or-macos"
        : "failed",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
