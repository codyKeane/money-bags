process.env.NEXT_TELEMETRY_DISABLED = "1";
// Keep an explicit falsey sentinel so a later project-environment load cannot
// reintroduce telemetry debug output after this preload runs.
process.env.NEXT_TELEMETRY_DEBUG = "";
// Installed Next drains SIGINT/SIGTERM only while this internal switch is
// falsey. Pin it before any project environment is loaded so systemd's clean
// status-143 contract cannot be disabled by an environment file.
process.env.NEXT_MANUAL_SIG_HANDLE = "";
// The rendered service exports this root before the preload runs. Load the one
// supported root environment file with Node's assignment semantics, then pin
// the configured database target (including its default) in process.env. Next
// therefore cannot select another database from a higher-precedence .env file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
const repositoryRoot = process.env.MONEYBAGS_REPOSITORY_ROOT;
if (repositoryRoot && process.env.DB_FILE_NAME === undefined) {
  try {
    process.loadEnvFile(path.join(repositoryRoot, ".env"));
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw new Error("Service environment could not be loaded safely.");
    }
  }
}
if (repositoryRoot && process.env.DB_FILE_NAME === undefined) {
  process.env.DB_FILE_NAME = "data/finance.db";
}
// This file is intentionally a CommonJS --require preload.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isMainThread } = require("node:worker_threads");
// This is the earliest direct-Next process boundary. Retain the private mask
// before Next cache or application code can create runtime artifacts. Next's
// worker threads inherit the process mask and cannot call process.umask()
// themselves, so only the main thread sets it.
if (
  process.platform !== "win32" &&
  isMainThread
) {
  process.umask(0o077);
}
