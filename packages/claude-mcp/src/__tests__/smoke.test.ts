import { describe, expect, it } from "vitest";
import { MODELS } from "../constants.js";
import { toolRegistry } from "../tools/index.js";

describe("@ask-llm/claude-mcp smoke", () => {
  it("registers ask-claude and ping", () => {
    expect(toolRegistry.map((tool) => tool.name).sort()).toEqual(["ask-claude", "ping"]);
  });

  it("defaults to Opus with a Sonnet fallback", () => {
    if (!process.env.ASK_CLAUDE_MODEL) expect(MODELS.DEFAULT).toBe("opus");
    if (!process.env.ASK_CLAUDE_FALLBACK_MODEL) expect(MODELS.FALLBACK).toBe("sonnet");
  });
});
