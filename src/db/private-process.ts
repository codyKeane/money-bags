import { isMainThread } from "node:worker_threads";

export const PRIVATE_PROCESS_UMASK = 0o077;

export class PrivateProcessUmaskError extends Error {
  readonly code = "ERR_MONEYBAGS_PRIVATE_UMASK_UNAVAILABLE";

  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "PrivateProcessUmaskError";
  }
}

interface PrivateProcessUmaskOptions {
  readonly platform?: NodeJS.Platform;
  readonly mainThread?: boolean;
}

// SQLite can create the database, WAL, and shared-memory files at different
// points in a process lifetime. Keep the process mask private rather than
// restoring the inherited mask after the first database open.
export function enforcePrivateProcessUmask(
  options: PrivateProcessUmaskOptions = {},
): void {
  if ((options.platform ?? process.platform) === "win32") return;
  if (!(options.mainThread ?? isMainThread)) {
    throw new PrivateProcessUmaskError(
      "Private SQLite storage cannot be opened from a Node worker thread because process umask is unavailable there.",
    );
  }
  try {
    process.umask(PRIVATE_PROCESS_UMASK);
  } catch (error) {
    throw new PrivateProcessUmaskError(
      "Private SQLite process umask could not be enforced.",
      { cause: error },
    );
  }
}
