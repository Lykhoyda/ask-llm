import { describe, expect, it } from "vitest";
import { toolRegistry } from "../tools/index.js";

describe("Grok MCP package smoke", () => {
  it("exposes only the expected provider tools", () => {
    expect(toolRegistry.map((tool) => tool.name).sort()).toEqual(["ask-grok", "ping"]);
    for (const tool of toolRegistry) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.zodSchema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });
});
