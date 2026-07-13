import { describe, expect, it } from "vitest";
import { FACTORY_DEFAULT_MODEL } from "../../constants.js";
import { askClaudeTool } from "../ask-claude.tool.js";
import { toolRegistry } from "../index.js";

const EXPECTED_TOOLS = ["ask-claude", "ping"];

describe("Claude tool contract", () => {
  it("registers exactly the expected tools", () => {
    expect(toolRegistry.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("exposes a structured, read-only ask-claude tool", () => {
    expect(askClaudeTool.outputSchema).toBeDefined();
    expect(askClaudeTool.annotations?.readOnlyHint).toBe(true);
    expect(askClaudeTool.description).toContain(FACTORY_DEFAULT_MODEL);
    expect(askClaudeTool.description).toContain("Read, Glob, and Grep");
  });

  it("accepts sessions and safe relative includeDirs", () => {
    expect(
      askClaudeTool.zodSchema.safeParse({
        prompt: "review",
        sessionId: "session-1",
        includeDirs: ["packages/api"],
      }).success,
    ).toBe(true);
  });

  it.each([["../secrets"], ["/etc"], ["~/code"]])("rejects unsafe includeDirs: %s", (dir) => {
    expect(askClaudeTool.zodSchema.safeParse({ prompt: "review", includeDirs: [dir] }).success).toBe(false);
  });
});
