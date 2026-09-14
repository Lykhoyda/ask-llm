import { configDefaults, defineConfig } from "vitest/config";

// The codex-pair hook scripts are POSIX-only (documented in BUGS.md: "Hook
// command is POSIX-only"): these suites spawn sh-based fake-codex fixtures and
// assert executable bits. Skip them on win32 so a local run there does not
// fail on missing POSIX fixtures; CI does not cover Windows (ADR-159).
const POSIX_ONLY_SUITES = [
  "src/__tests__/codex-pair-watch.test.ts",
  "src/__tests__/codex-pair-debounce-worker.test.ts",
  "src/__tests__/codex-pair-prompt-drain.test.ts",
  // stop-gate.test.ts deliberately NOT listed: its logic is pure and the
  // path assertion is join()-portable (PR #200 review).
];

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...(process.platform === "win32" ? POSIX_ONLY_SUITES : [])],
  },
});
