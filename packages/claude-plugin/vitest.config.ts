import { configDefaults, defineConfig } from "vitest/config";

// The codex-pair hook scripts are POSIX-only (documented in BUGS.md: "Hook
// command is POSIX-only"): these suites spawn sh-based fake-codex fixtures and
// assert executable bits, neither of which exists on Windows. The plugin is
// private (never published to npm); the Windows CI leg (ADR-129) exists to
// gate the five PUBLISHED packages, whose suites run in full on every OS.
const POSIX_ONLY_SUITES = [
  "src/__tests__/codex-pair-watch.test.ts",
  "src/__tests__/codex-pair-debounce-worker.test.ts",
  "src/__tests__/codex-pair-prompt-drain.test.ts",
  "src/__tests__/stop-gate.test.ts",
];

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...(process.platform === "win32" ? POSIX_ONLY_SUITES : [])],
  },
});
