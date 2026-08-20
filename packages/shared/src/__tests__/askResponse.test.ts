import { describe, expect, it } from "vitest";
import { type AskResponse, askResponseSchema } from "../askResponse.js";

describe("askResponseSchema", () => {
  it("accepts the minimum required shape (provider + response + model)", () => {
    const sample: AskResponse = { provider: "gemini", response: "hello", model: "gemini-3.1-pro-preview" };
    expect(askResponseSchema.safeParse(sample).success).toBe(true);
  });

  it("accepts all providers", () => {
    for (const provider of ["gemini", "codex", "claude", "ollama", "antigravity"] as const) {
      const sample: AskResponse = { provider, response: "x", model: "m" };
      expect(askResponseSchema.safeParse(sample).success).toBe(true);
    }
  });

  it("rejects unknown provider strings", () => {
    expect(askResponseSchema.safeParse({ provider: "unknown", response: "x", model: "m" }).success).toBe(false);
  });

  it("accepts optional harness attribution separately from provider/model", () => {
    const result = askResponseSchema.safeParse({
      provider: "grok",
      response: "ok",
      model: "cursor-grok-4.6-high",
      harness: "cursor-agent",
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ provider: "grok", harness: "cursor-agent" });
  });

  it("accepts optional sessionId", () => {
    const sample: AskResponse = { provider: "codex", response: "ok", model: "gpt-5.4", sessionId: "thread-abc" };
    expect(askResponseSchema.safeParse(sample).success).toBe(true);
  });

  it("accepts optional usage with full UsageStats shape", () => {
    const sample: AskResponse = {
      provider: "gemini",
      response: "ok",
      model: "gemini-3.1-pro-preview",
      usage: {
        provider: "gemini",
        model: "gemini-3.1-pro-preview",
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 0,
        thinkingTokens: 25,
        durationMs: 1500,
        fellBack: false,
      },
    };
    expect(askResponseSchema.safeParse(sample).success).toBe(true);
  });

  it("rejects malformed usage (missing required fields)", () => {
    const broken = {
      provider: "gemini",
      response: "ok",
      model: "m",
      usage: { provider: "gemini", model: "m" }, // missing durationMs and fellBack
    };
    expect(askResponseSchema.safeParse(broken).success).toBe(false);
  });

  it("requires response to be a string (not undefined or other types)", () => {
    expect(askResponseSchema.safeParse({ provider: "ollama", model: "m" }).success).toBe(false);
    expect(askResponseSchema.safeParse({ provider: "ollama", response: 123, model: "m" }).success).toBe(false);
  });
});
