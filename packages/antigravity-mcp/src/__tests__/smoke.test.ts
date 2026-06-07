import { describe, expect, it } from "vitest";
import { toolRegistry } from "../tools/index.js";

describe("ask-antigravity-mcp smoke", () => {
  it("registers ask-antigravity and ping tools", () => {
    const names = toolRegistry.map((t) => t.name);
    expect(names).toContain("ask-antigravity");
    expect(names).toContain("ping");
  });

  it("ask-antigravity declares an outputSchema and includeDirs input", () => {
    const tool = toolRegistry.find((t) => t.name === "ask-antigravity");
    expect(tool?.outputSchema).toBeDefined();
    const parsed = tool?.zodSchema.safeParse({ prompt: "x", includeDirs: ["/a"] });
    expect(parsed?.success).toBe(true);
  });
});
