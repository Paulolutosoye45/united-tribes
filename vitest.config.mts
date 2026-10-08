import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Fast tests that need no database or network.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
