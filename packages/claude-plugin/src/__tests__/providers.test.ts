import { describe, expect, it } from "vitest";
import { providers } from "../index.js";

describe("ProviderExecutor wiring", () => {
  it("exports exactly four providers", () => {
    expect(providers).toHaveLength(4);
  });

  it("each provider has the expected name and CLI command", () => {
    // antigravity's CLI binary is `agy`, so command !== name for it
    const expectedCommand: Record<string, string> = {
      gemini: "gemini",
      codex: "codex",
      ollama: "ollama",
      antigravity: "agy",
    };
    expect(providers.map((p) => p.name).sort()).toEqual(Object.keys(expectedCommand).sort());
    for (const provider of providers) {
      expect(provider.command).toBe(expectedCommand[provider.name]);
    }
  });

  it("each provider's execute is a function", () => {
    for (const provider of providers) {
      expect(typeof provider.execute).toBe("function");
    }
  });

  it("provider names match the expected set", () => {
    const names = providers.map((p) => p.name);
    expect(names).toContain("gemini");
    expect(names).toContain("codex");
    expect(names).toContain("ollama");
    expect(names).toContain("antigravity");
  });
});
