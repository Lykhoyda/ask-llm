import { describe, expect, it } from "vitest";
import { FACTORY_DEFAULT_MODEL } from "../../constants.js";
import { toolRegistry } from "../index.js";

const EXPECTED_TOOLS = ["ask-gemini", "ask-gemini-edit", "fetch-chunk", "ping"];

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

  it("ask-gemini's description names the factory default model (env-invariant)", () => {
    const tool = toolRegistry.find((t) => t.name === "ask-gemini");
    expect(tool?.description).toContain(FACTORY_DEFAULT_MODEL);
  });
});
