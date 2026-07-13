import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeCodexCLI } from "../utils/codexExecutor.js";

const SMOKE = !!process.env.SMOKE_TEST;
const TIMEOUT = 120_000;

describe.skipIf(!SMOKE)("Codex CLI integration", () => {
  it(
    "returns a non-empty response for a simple prompt",
    async () => {
      const result = await executeCodexCLI({
        prompt: "What is 2+2? Reply with just the number.",
      });

      expect(result.response).toBeTruthy();
      expect(result.response.length).toBeGreaterThan(0);
      expect(result.response).toMatch(/4/);
    },
    TIMEOUT,
  );

  it(
    "answers with gpt-5.6-sol when no model override is set",
    async () => {
      const result = await executeCodexCLI({
        prompt: "Reply with the single word: ok",
      });

      expect(result.usage?.model).toBe("gpt-5.6-sol");
      expect(result.usage?.fellBack).toBe(false);
    },
    TIMEOUT,
  );
});

describe.skipIf(!SMOKE)("Codex CLI per-provider timeout (#45)", () => {
  // End-to-end smoke: set ASK_CODEX_TIMEOUT_MS to a tiny value, invoke the
  // real CLI, and assert the timeout fires with a message that references the
  // new env var. This catches regressions that mock-based tests miss — e.g.,
  // someone bypasses the resolver and reads GMCPT_TIMEOUT_MS directly inside
  // executeCommand, which would still pass mocks but fail this smoke.
  const TINY_TIMEOUT = 50;
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.ASK_CODEX_TIMEOUT_MS;
    process.env.ASK_CODEX_TIMEOUT_MS = String(TINY_TIMEOUT);
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ASK_CODEX_TIMEOUT_MS;
    else process.env.ASK_CODEX_TIMEOUT_MS = original;
  });

  it(
    "ASK_CODEX_TIMEOUT_MS=50 fires before codex CLI can respond",
    async () => {
      // 50ms is guaranteed to fire before codex's heavy startup (codex 0.128
      // takes >1s just to load its config). The real codex CLI must be on
      // PATH for this smoke to be meaningful — covered by the SMOKE_TEST gate.
      await expect(executeCodexCLI({ prompt: "Reply with: ok" })).rejects.toThrow(/Command timed out/);
    },
    TIMEOUT,
  );
});
