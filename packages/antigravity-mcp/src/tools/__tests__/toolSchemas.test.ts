import { describe, expect, it } from "vitest";
import { askAntigravityTool } from "../ask-antigravity.tool.js";

describe("ask-antigravity includeDirs validation (parity with codex/gemini tools)", () => {
  it("rejects path traversal", () => {
    expect(askAntigravityTool.zodSchema.safeParse({ prompt: "p", includeDirs: ["../secrets"] }).success).toBe(false);
  });

  it("rejects absolute paths", () => {
    expect(askAntigravityTool.zodSchema.safeParse({ prompt: "p", includeDirs: ["/etc"] }).success).toBe(false);
  });

  it("rejects home-relative paths", () => {
    expect(askAntigravityTool.zodSchema.safeParse({ prompt: "p", includeDirs: ["~/code"] }).success).toBe(false);
  });

  it("accepts relative monorepo paths", () => {
    expect(askAntigravityTool.zodSchema.safeParse({ prompt: "p", includeDirs: ["packages/api"] }).success).toBe(true);
  });
});
