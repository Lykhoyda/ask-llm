import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeAntigravityCLI } from "../utils/antigravityExecutor.js";

const SMOKE = !!process.env.SMOKE_TEST;
// Cap the executor's OWN timeout below the vitest ceiling so executeCommand owns
// cancellation (SIGTERM→SIGKILL of agy) on a slow run. Without this, vitest's
// default (or a ceiling under the executor's 300s default) would abort the test
// first and leave the agy agent process running. agy spawns a full agent, so
// it's the slowest provider — 180s is generous for a trivial prompt.
const EXECUTOR_TIMEOUT_MS = 180_000;
const TIMEOUT = EXECUTOR_TIMEOUT_MS + 20_000;

describe.skipIf(!SMOKE)("Antigravity (agy) CLI integration", () => {
  let prevTimeout: string | undefined;
  beforeEach(() => {
    prevTimeout = process.env.ASK_ANTIGRAVITY_TIMEOUT_MS;
    process.env.ASK_ANTIGRAVITY_TIMEOUT_MS = String(EXECUTOR_TIMEOUT_MS);
  });
  afterEach(() => {
    if (prevTimeout === undefined) delete process.env.ASK_ANTIGRAVITY_TIMEOUT_MS;
    else process.env.ASK_ANTIGRAVITY_TIMEOUT_MS = prevTimeout;
  });

  it(
    "returns a non-empty response for a simple prompt",
    async () => {
      const result = await executeAntigravityCLI({
        prompt: "What is 2+2? Reply with just the number.",
      });

      expect(result.response).toBeTruthy();
      expect(result.response.length).toBeGreaterThan(0);
      expect(result.response).toMatch(/4/);
    },
    TIMEOUT,
  );
});
