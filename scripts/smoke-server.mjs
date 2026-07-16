import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPOSITORY_ROOT_ENV_NAME,
  TEMP_DB_ROOT_ENV_NAME,
  TEMP_DB_TOKEN_ENV_NAME,
  cleanupTemporaryDatabaseLease,
  createTemporaryDatabaseLease,
} from "./temporary-db.mjs";
import { assertProcessTreeCleanupSupported } from "./run-with-temp-db.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 3100;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requireAvailablePort(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen({ host: LOOPBACK_HOST, port, exclusive: true }, () => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

function observeClose(child) {
  return new Promise((resolve) => {
    let spawnError;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => resolve({ code, signal, spawnError }));
  });
}

function signalProcessTree(child, signal) {
  if (child.pid === undefined) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function processGroupExists(pid) {
  if (pid === undefined) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  if (pid === undefined) return;
  const deadline = Date.now() + Math.max(timeoutMs, 250);
  while (processGroupExists(pid) && Date.now() < deadline) {
    await delay(20);
  }
  if (processGroupExists(pid)) {
    throw new Error("Smoke process group did not stop before database cleanup.");
  }
}

async function stopProcessTree(child, closePromise, timeoutMs) {
  const terminationRequested = signalProcessTree(child, "SIGTERM");
  let escalated = false;
  let childResult = await Promise.race([
    closePromise,
    delay(timeoutMs).then(() => undefined),
  ]);

  if (childResult === undefined || processGroupExists(child.pid)) {
    escalated = signalProcessTree(child, "SIGKILL");
    if (childResult === undefined) {
      childResult = await Promise.race([
        closePromise,
        delay(Math.max(timeoutMs, 250)).then(() => undefined),
      ]);
    }
  }
  if (childResult === undefined) {
    throw new Error("Smoke child did not stop after forced termination.");
  }
  await waitForProcessGroupExit(child.pid, timeoutMs);
  return { childResult, terminationRequested, escalated };
}

async function hasHealthyResponse(port, expectedDatabasePath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_000);
  timer.unref();
  try {
    const response = await fetch(`http://${LOOPBACK_HOST}:${port}/api/health`, {
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status !== 200) return false;
    const body = await response.json();
    // The health route opens and queries its configured database. Requiring
    // this lease's file ties a 200 response to the spawned server rather than
    // to an unrelated loopback process that won a bind race.
    return body?.ok === true && existsSync(expectedDatabasePath);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function oneHealthObservation(closePromise, port, expectedDatabasePath) {
  return Promise.race([
    closePromise.then((childResult) => ({ childResult })),
    hasHealthyResponse(port, expectedDatabasePath).then((healthy) => ({ healthy })),
  ]);
}

async function waitForHealth(
  closePromise,
  port,
  expectedDatabasePath,
  timeoutMs,
  interrupted,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (interrupted()) return { healthy: false, interrupted: true };
    const observation = await oneHealthObservation(
      closePromise,
      port,
      expectedDatabasePath,
    );
    if (observation.childResult !== undefined) {
      return { healthy: false, childResult: observation.childResult };
    }
    if (observation.healthy) {
      // A second observation prevents a one-response process that immediately
      // exits from being reported as a successful bounded server smoke.
      await delay(25);
      if (interrupted()) return { healthy: false, interrupted: true };
      const confirmation = await oneHealthObservation(
        closePromise,
        port,
        expectedDatabasePath,
      );
      if (confirmation.childResult !== undefined) {
        return { healthy: false, childResult: confirmation.childResult };
      }
      if (confirmation.healthy) return { healthy: true };
    }
    await delay(100);
  }
  return { healthy: false, timedOut: true };
}

export async function runServerSmoke(mode, options = {}) {
  if (mode !== "dev" && mode !== "start") {
    throw new Error("Smoke mode must be dev or start.");
  }
  const port = options.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Smoke port must be an integer from 1 through 65535.");
  }
  assertProcessTreeCleanupSupported();

  const activeRepositoryRoot = options.repositoryRoot ?? repositoryRoot;
  const environment = options.environment ?? process.env;
  const log = options.log ?? ((message) => console.error(message));
  const signalSource = options.signalSource ?? process;
  const spawnImplementation = options.spawnImplementation ?? spawn;
  const shutdownTimeoutMs =
    options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  let lease;
  let child;
  let closePromise;
  let childResult;
  let requestedSignal;
  let signalCount = 0;
  let treeError;
  let primaryError;
  let cleanupError;
  let code = 1;

  const forward = (signal) => {
    requestedSignal ??= signal;
    signalCount += 1;
    if (!child) return;
    try {
      signalProcessTree(child, signalCount === 1 ? signal : "SIGKILL");
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
      repositoryRoot: activeRepositoryRoot,
      inheritedDatabaseFileName: environment.DB_FILE_NAME,
      temporaryDirectory: options.temporaryDirectory,
    });
    log(`[temp-db] target: ${lease.databasePath}`);
    options.onTarget?.(lease.databasePath);

    if (requestedSignal === undefined) await requireAvailablePort(port);
    if (requestedSignal === undefined) {
      if (options.nodeArguments === undefined && port !== DEFAULT_PORT) {
        throw new Error("The packaged Next smoke launcher uses port 3100.");
      }
      const nodeArguments =
        options.nodeArguments ?? [
          path.join(activeRepositoryRoot, "scripts", "run-next.mjs"),
          mode,
        ];
      child = spawnImplementation(process.execPath, nodeArguments, {
        cwd: activeRepositoryRoot,
        env: {
          ...environment,
          DB_FILE_NAME: lease.databasePath,
          [REPOSITORY_ROOT_ENV_NAME]: lease.repositoryRoot,
          [TEMP_DB_ROOT_ENV_NAME]: lease.rootPath,
          [TEMP_DB_TOKEN_ENV_NAME]: lease.ownershipToken,
        },
        stdio: options.stdio ?? "inherit",
        shell: false,
        detached: true,
      });
      closePromise = observeClose(child);
      const readiness = await waitForHealth(
        closePromise,
        port,
        lease.databasePath,
        options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
        () => requestedSignal !== undefined,
      );
      if (readiness.healthy) {
        await options.verifyHealthyServer?.({
          baseUrl: `http://${LOOPBACK_HOST}:${port}`,
          databasePath: lease.databasePath,
          port,
        });
        const stopped = await stopProcessTree(child, closePromise, shutdownTimeoutMs);
        childResult = stopped.childResult;
        code = stopped.terminationRequested ? 0 : 1;
      } else if (readiness.childResult !== undefined) {
        childResult = readiness.childResult;
        // Exiting before two stable health responses is always a failed smoke,
        // even when the server process exits with status zero.
        code = 1;
      }
    }
  } catch (error) {
    primaryError = error;
    code = 1;
  } finally {
    if (child && closePromise) {
      try {
        if (processGroupExists(child.pid) || child.exitCode === null) {
          const stopped = await stopProcessTree(child, closePromise, shutdownTimeoutMs);
          childResult ??= stopped.childResult;
        } else {
          childResult ??= await closePromise;
        }
      } catch (error) {
        treeError ??= error;
      }
    }

    if (lease !== undefined) {
      if (treeError !== undefined) {
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

  if (lease === undefined) throw primaryError;
  if (primaryError !== undefined || cleanupError !== undefined) code = 1;
  let signal =
    cleanupError === undefined
      ? requestedSignal ?? (code === 0 ? undefined : childResult?.signal ?? undefined)
      : undefined;
  try {
    log(`[temp-db] status: ${cleanupError ? "cleanup-failed" : signal ?? code}`);
  } catch (error) {
    primaryError ??= error;
    code = 1;
    signal = undefined;
  }
  return Object.freeze({
    code,
    signal,
    rootPath: lease.rootPath,
    cleanupError,
    error: primaryError,
  });
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if ((mode !== "dev" && mode !== "start") || extra.length > 0) {
    console.error("Usage: node scripts/smoke-server.mjs <dev|start>");
    process.exitCode = 2;
    return;
  }
  try {
    const result = await runServerSmoke(mode);
    if (result.signal && process.platform !== "win32") {
      process.kill(process.pid, result.signal);
    } else {
      process.exitCode = result.code;
    }
  } catch (error) {
    if (error?.code === "ERR_MONEYBAGS_UNSUPPORTED_PLATFORM") {
      console.error("[temp-db] status: unsupported-platform use WSL, Linux, or macOS");
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
