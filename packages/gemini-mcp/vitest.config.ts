import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    // Keep above the 5s default so mock-only executor tests do not flake
    // under a loaded runner (originally observed when the default timed out
    // on tests that take <5ms locally).
    testTimeout: 30_000,
  },
});
