import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    isolate: true,
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/worker-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
