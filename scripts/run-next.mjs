#!/usr/bin/env node
import "./next-telemetry-disabled.cjs";
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveInstalledPackageBin } from "./run-with-temp-db.mjs";
import { REPOSITORY_ROOT_ENV_NAME } from "./temporary-db.mjs";

const REPOSITORY_ROOT = realpathSync.native(path.resolve(import.meta.dirname, ".."));
export const TRUST_LOOPBACK_PROXY_ENV_NAME =
  "MONEYBAGS_TRUST_LOOPBACK_PROXY";
const MODES = Object.freeze({
  dev: ["dev", "-p", "3100", "-H", "127.0.0.1"],
  start: ["start", "-p", "3100", "-H", "127.0.0.1"],
  "dev:lan": ["dev", "-p", "3100"],
  "start:lan": ["start", "-p", "3100"],
});

export function nextArgumentsForMode(mode, forwardedArguments = []) {
  const configured = MODES[mode];
  if (configured === undefined) throw new Error("Unsupported Next launcher mode.");
  return [...configured, ...forwardedArguments];
}

export function trustsLoopbackProxyForMode(mode, forwardedArguments = []) {
  if (mode !== "dev" && mode !== "start") return false;
  return !forwardedArguments.some(
    (argument) =>
      argument.startsWith("-H") || argument.startsWith("--hostname"),
  );
}

async function main() {
  const [mode, ...forwardedArguments] = process.argv.slice(2);
  if (!Object.hasOwn(MODES, mode)) {
    console.error("Usage: node scripts/run-next.mjs <dev|start|dev:lan|start:lan>");
    process.exitCode = 2;
    return;
  }

  // The launcher is the POSIX main-process boundary. Retain the private mask
  // before Next or application code can create SQLite DB/WAL/SHM artifacts.
  // Windows ACL verification remains explicit operator work.
  if (process.platform !== "win32") process.umask(0o077);

  const binPath = resolveInstalledPackageBin("next", "next", {
    repositoryRoot: REPOSITORY_ROOT,
  });
  process.env[REPOSITORY_ROOT_ENV_NAME] = REPOSITORY_ROOT;
  process.env[TRUST_LOOPBACK_PROXY_ENV_NAME] = trustsLoopbackProxyForMode(
    mode,
    forwardedArguments,
  )
    ? "1"
    : "0";
  process.argv = [
    process.execPath,
    binPath,
    ...nextArgumentsForMode(mode, forwardedArguments),
  ];
  await import(pathToFileURL(binPath).href);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  await main();
}
