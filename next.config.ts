import { realpathSync } from "node:fs";
import type { NextConfig } from "next";
import {
  BUILT_ALLOWED_ORIGINS_ENV_NAME,
  createBuiltOriginConfiguration,
} from "./src/lib/origin-policy";
import { GLOBAL_SECURITY_HEADERS } from "./src/lib/security-headers";

const projectRoot = realpathSync.native(__dirname);
const originConfiguration = createBuiltOriginConfiguration(
  process.env.EXTRA_ALLOWED_ORIGINS,
);
const traceExcludes = [
  "data/**/*",
  "imports/**/*",
  "backups/**/*",
  ".env*",
  "src/**/*.test.*",
  "src/test/**/*",
  "deploy/**/*",
  "AGENTS.md",
  "CLAUDE.md",
  "IMPLEMENTATION*.md",
  "README.md",
  "TODO.md",
  "USER_MANUAL.md",
  "vitest.config.ts",
  "eslint.config.mjs",
  "drizzle.config.ts",
  "scripts/**/*.test.*",
  "scripts/audit-data-path.ts",
  "scripts/backup-db.ts",
  "scripts/build-privacy-policy.mjs",
  "scripts/check-build-privacy.mjs",
  "scripts/disable-tsx-cache.mjs",
  "scripts/import-csv.ts",
  "scripts/render-systemd-units.mjs",
  "scripts/run-next.mjs",
  "scripts/run-with-temp-db.mjs",
  "scripts/service-preflight.ts",
  "scripts/smoke-server.mjs",
  "scripts/temporary-db.mjs",
  "scripts/validate-build-privacy.mjs",
  "scripts/restore-db.ts",
  "scripts/verify-backup.ts",
] as const;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compiler: {
    defineServer: {
      // Server-only build snapshot. Production origin changes require both a
      // new build and restart; an old bundle never rereads the raw setting.
      [`process.env.${BUILT_ALLOWED_ORIGINS_ENV_NAME}`]:
        originConfiguration.serializedOrigins,
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: GLOBAL_SECURITY_HEADERS.map((header) => ({ ...header })),
      },
    ];
  },
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingExcludes: {
    "/*": [...traceExcludes],
    // Installed Next 16.2.10 also consults this key for its framework server
    // trace. The all-manifest checker remains the authoritative boundary.
    "next-server": [...traceExcludes],
  },
  outputFileTracingIncludes: {
    "/*": [
      "drizzle/**/*",
      "node_modules/better-sqlite3/**/*",
      "scripts/next-telemetry-disabled.cjs",
    ],
  },
  // better-sqlite3 is a native module — load via require, never bundle.
  // (It's in Next's built-in external list; explicit for self-documentation.)
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: {
      // Next's host-only check is coarse defense in depth. The application
      // guard separately compares exact normalized origins, including scheme.
      allowedOrigins: [...originConfiguration.allowedHosts],
    },
  },
};

export default nextConfig;
