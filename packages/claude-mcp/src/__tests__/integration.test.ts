import { describe, expect, it } from "vitest";
import { executeClaudeCLI } from "../utils/claudeExecutor.js";

const SMOKE = !!process.env.SMOKE_TEST;

describe.skipIf(!SMOKE)("Claude CLI integration", () => {
  it("returns a non-empty response and native session id", async () => {
    const result = await executeClaudeCLI({ prompt: "What is 2+2? Reply with just the number." });
    expect(result.response).toMatch(/4/);
    expect(result.sessionId).toBeTruthy();
    expect(result.usage.provider).toBe("claude");
  }, 120_000);
});
