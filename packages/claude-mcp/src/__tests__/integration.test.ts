import { describe, expect, it } from "vitest";
import { CLAUDE_HOST_ENV_VAR } from "../constants.js";
import { executeClaudeCLI } from "../utils/claudeExecutor.js";

const SMOKE = !!process.env.SMOKE_TEST;
// The nested-session guard (ADR-134) makes this test structurally impossible
// to run from inside a Claude Code session: executeClaudeCLI throws before
// spawning. Skip-with-warning there, mirroring the smoke harness's quota
// escape, so pre-push works from the primary dev environment.
const NESTED = !!process.env[CLAUDE_HOST_ENV_VAR];
if (SMOKE && NESTED) {
  console.warn(
    "⚠️  Claude smoke skipped: running inside a Claude Code session, where the ADR-134 nested-session guard blocks ask-claude by design. Push from a non-Claude-Code terminal to exercise this leg.",
  );
}

describe.skipIf(!SMOKE || NESTED)("Claude CLI integration", () => {
  it("returns a non-empty response and native session id", async () => {
    const result = await executeClaudeCLI({ prompt: "What is 2+2? Reply with just the number." });
    expect(result.response).toMatch(/4/);
    expect(result.sessionId).toBeTruthy();
    expect(result.usage.provider).toBe("claude");
  }, 120_000);
});
