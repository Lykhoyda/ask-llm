import { describe, expect, it } from "vitest";
import { DEFAULT_REASONING_EFFORT, MODELS } from "../constants.js";
import { toolRegistry } from "../tools/index.js";

describe("MCP server smoke test", () => {
  const expectedTools = ["ask-codex", "ask-codex-edit", "ping"];

  it("has exactly 3 tools registered", () => {
    const toolNames = toolRegistry.map((t) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(expectedTools));
    expect(toolNames).toHaveLength(expectedTools.length);
  });

  for (const toolName of expectedTools) {
    it(`tool "${toolName}" has required properties`, () => {
      const tool = toolRegistry.find((t) => t.name === toolName);
      expect(tool).toBeDefined();
      expect(tool?.name).toBe(toolName);
      expect(tool?.description).toBeTruthy();
      expect(tool?.zodSchema).toBeDefined();
      expect(typeof tool?.execute).toBe("function");
    });
  }
});

describe("Codex default model version", () => {
  it("defaults to gpt-5.6-sol when ASK_CODEX_MODEL is not set", () => {
    if (process.env.ASK_CODEX_MODEL) return;
    expect(MODELS.DEFAULT).toBe("gpt-5.6-sol");
  });

  it("falls back to gpt-5.6-terra when ASK_CODEX_FALLBACK_MODEL is not set", () => {
    if (process.env.ASK_CODEX_FALLBACK_MODEL) return;
    expect(MODELS.FALLBACK).toBe("gpt-5.6-terra");
  });

  it("uses the Sol default for the legacy preferred tier unless overridden", () => {
    if (process.env.ASK_CODEX_MODEL || process.env.ASK_CODEX_PREFERRED_MODEL) return;
    expect(MODELS.PREFERRED).toBe(MODELS.DEFAULT);
  });

  it("preserves medium reasoning effort unless overridden", () => {
    if (process.env.ASK_CODEX_REASONING_EFFORT) return;
    expect(DEFAULT_REASONING_EFFORT).toBe("medium");
  });
});
