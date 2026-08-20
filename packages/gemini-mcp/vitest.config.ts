import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    // Windows runners are 2-3x slower (ADR-129): the 5s default timed out on
    // mock-only executor tests that take <5ms locally.
    testTimeout: 30_000,
  },
});
