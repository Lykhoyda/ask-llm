import { createSessionUsage, type UsageStats } from "@ask-llm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/antigravityExecutor.js", () => ({
  executeAntigravityCLI: vi.fn(),
}));

import { executeAntigravityCLI } from "../../utils/antigravityExecutor.js";
import { askAntigravityTool } from "../ask-antigravity.tool.js";

const mockExecuteAntigravityCLI = vi.mocked(executeAntigravityCLI);
const usage: UsageStats = {
  provider: "antigravity",
  model: "gemini-3.1-pro",
  inputTokens: 120,
  outputTokens: 30,
  cachedTokens: 20,
  thinkingTokens: 10,
  durationMs: 500,
  fellBack: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ask-antigravity usage accounting", () => {
  it("records successful usage in the session stats", async () => {
    mockExecuteAntigravityCLI.mockResolvedValue({
      response: "answer",
      model: usage.model,
      sessionId: undefined,
      usage,
    });
    const sessionUsage = createSessionUsage();

    await askAntigravityTool.execute({ prompt: "question" }, undefined, sessionUsage.record);

    expect(sessionUsage.snapshot()).toMatchObject({
      totalCalls: 1,
      totalInputTokens: 120,
      totalOutputTokens: 30,
      byProvider: { antigravity: { calls: 1 } },
    });
  });
});
