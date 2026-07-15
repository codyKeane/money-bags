#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveInstalledPackageBin } from "./run-with-temp-db.mjs";
import { REPOSITORY_ROOT_ENV_NAME } from "./temporary-db.mjs";

const REPOSITORY_ROOT = realpathSync.native(path.resolve(import.meta.dirname, ".."));
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

async function main() {
  const [mode, ...forwardedArguments] = process.argv.slice(2);
  if (!Object.hasOwn(MODES, mode)) {
    console.error("Usage: node scripts/run-next.mjs <dev|start|dev:lan|start:lan>");
    process.exitCode = 2;
    return;
  }

  const binPath = resolveInstalledPackageBin("next", "next", {
    repositoryRoot: REPOSITORY_ROOT,
  });
  process.env[REPOSITORY_ROOT_ENV_NAME] = REPOSITORY_ROOT;
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
