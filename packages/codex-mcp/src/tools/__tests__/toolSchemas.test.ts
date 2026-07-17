import { describe, expect, it } from "vitest";
import { FACTORY_DEFAULT_MODEL } from "../../constants.js";
import { askCodexTool } from "../ask-codex.tool.js";
import { askCodexEditTool } from "../ask-codex-edit.tool.js";
import { toolRegistry } from "../index.js";

const tools = [
  ["ask-codex", askCodexTool],
  ["ask-codex-edit", askCodexEditTool],
] as const;

describe.each(tools)("%s includeDirs validation (parity with ask-gemini-edit)", (_name, tool) => {
  it("rejects path traversal", () => {
    expect(tool.zodSchema.safeParse({ prompt: "p", includeDirs: ["../secrets"] }).success).toBe(false);
  });

  it("rejects absolute paths", () => {
    expect(tool.zodSchema.safeParse({ prompt: "p", includeDirs: ["/etc"] }).success).toBe(false);
  });

  it("rejects home-relative paths", () => {
    expect(tool.zodSchema.safeParse({ prompt: "p", includeDirs: ["~/code"] }).success).toBe(false);
  });

  it("accepts relative monorepo paths", () => {
    expect(tool.zodSchema.safeParse({ prompt: "p", includeDirs: ["packages/api"] }).success).toBe(true);
  });
});

const EXPECTED_TOOLS = ["ask-codex", "ask-codex-edit", "ping"];

describe("tool contract (drift guards)", () => {
  it("registers exactly the expected tools", () => {
    expect(toolRegistry.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it.each(toolRegistry.map((t) => [t.name, t] as const))("%s exposes a complete MCP surface", (_name, tool) => {
    expect(tool.description.length).toBeGreaterThan(20);
    expect(tool.zodSchema).toBeDefined();
    expect(tool.annotations?.title).toBeTruthy();
    expect(typeof tool.annotations?.readOnlyHint).toBe("boolean");
  });

  it("ask-codex's description names the factory default model (env-invariant)", () => {
    expect(askCodexTool.description).toContain(FACTORY_DEFAULT_MODEL);
  });

  it("marks both Codex tools read-only because they only return analysis/proposals", () => {
    expect(askCodexTool.annotations?.readOnlyHint).toBe(true);
    expect(askCodexEditTool.annotations?.readOnlyHint).toBe(true);
  });

  it("ask-codex accepts an optional `preferred` boolean (default off)", () => {
    expect(askCodexTool.zodSchema.safeParse({ prompt: "p" }).success).toBe(true);
    expect(askCodexTool.zodSchema.safeParse({ prompt: "p", preferred: true }).success).toBe(true);
    expect(askCodexTool.zodSchema.safeParse({ prompt: "p", preferred: false }).success).toBe(true);
    expect(askCodexTool.zodSchema.safeParse({ prompt: "p", preferred: "yes" }).success).toBe(false);
    // Omitting it must stay undefined, never silently default to true — otherwise
    // the opt-in contract would flip and every ask-codex call would prefer an
    // ASK_CODEX_PREFERRED_MODEL override.
    expect(askCodexTool.zodSchema.parse({ prompt: "p" }).preferred).toBeUndefined();
  });

  it("ask-codex accepts documented GPT-5.6 reasoning efforts", () => {
    for (const reasoningEffort of ["low", "medium", "high", "xhigh", "max"]) {
      expect(askCodexTool.zodSchema.safeParse({ prompt: "p", reasoningEffort }).success).toBe(true);
    }
    expect(askCodexTool.zodSchema.safeParse({ prompt: "p", reasoningEffort: "ultra" }).success).toBe(false);
    expect(askCodexTool.zodSchema.safeParse({ prompt: "p", reasoningEffort: "extreme" }).success).toBe(false);
  });
});
