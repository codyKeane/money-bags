import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — load via require, never bundle.
  // (It's in Next's built-in external list; explicit for self-documentation.)
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: {
      // Server Actions reject requests whose Origin differs from the bound
      // Host (CSRF check). Behind `tailscale serve` the browser origin is
      // https://<host>.<tailnet>.ts.net while the app binds 127.0.0.1, so
      // allow tailnet origins. Adds no exposure: only tailnet devices can
      // reach the server at all. EXTRA_ALLOWED_ORIGINS (comma-separated)
      // covers Headscale/custom domains.
      allowedOrigins: [
        "*.ts.net",
        ...(process.env.EXTRA_ALLOWED_ORIGINS?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) ?? []),
      ],
    },
  },
};

export default nextConfig;
