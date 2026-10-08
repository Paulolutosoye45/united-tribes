import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Database tests: start a throwaway Postgres, apply every migration, then
// check the access rules. Needs no Docker and no network.
// Postgres refuses to start as root, so run these as a normal user.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/db/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    maxWorkers: 4,
  },
});
