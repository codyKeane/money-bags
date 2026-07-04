import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — load via require, never bundle.
  // (It's in Next's built-in external list; explicit for self-documentation.)
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
