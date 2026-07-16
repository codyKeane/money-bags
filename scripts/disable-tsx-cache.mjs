// The data-path audit is metadata-only. Disable tsx's transform cache before
// the loader initializes so the package command does not need CLI IPC/cache
// artifacts merely to execute the TypeScript entry point.
process.env.TSX_DISABLE_CACHE = "1";
