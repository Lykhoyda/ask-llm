import { describe, expect, it } from "vitest";
import { MODELS } from "../constants.js";
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

describe("Codex default model version (ADR-067)", () => {
  it("defaults to gpt-5.5 when ASK_CODEX_MODEL is not set", () => {
    if (process.env.ASK_CODEX_MODEL) return;
    expect(MODELS.DEFAULT).toBe("gpt-5.5");
  });

  it("falls back to gpt-5.5-mini when ASK_CODEX_FALLBACK_MODEL is not set", () => {
    if (process.env.ASK_CODEX_FALLBACK_MODEL) return;
    expect(MODELS.FALLBACK).toBe("gpt-5.5-mini");
  });
});
