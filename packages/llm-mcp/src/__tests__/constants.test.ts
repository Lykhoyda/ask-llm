import { PROVIDERS as CANONICAL_PROVIDERS } from "@ask-llm/shared";
import { describe, expect, it } from "vitest";
import { getEligibleProviderKeys, INSTALL_HINTS, PROVIDERS } from "../constants.js";
import { buildProviderSpecs } from "../utils/providerSpecs.js";

describe("provider registry drift guard", () => {
  it("registry keys exactly match the canonical shared PROVIDERS list", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([...CANONICAL_PROVIDERS].sort());
  });

  it("every provider has an install hint", () => {
    expect(Object.keys(INSTALL_HINTS).sort()).toEqual([...CANONICAL_PROVIDERS].sort());
  });

  it("registers Claude Code as the Claude provider executor", () => {
    expect(PROVIDERS.claude).toMatchObject({
      command: "claude",
      executorModule: "@ask-llm/claude-mcp/executor",
      executorFn: "executeClaudeCLI",
      defaultModel: "opus",
      disabledWhenEnvVar: "CLAUDECODE",
    });
  });

  it("declares model environment variables for every machine provider", () => {
    expect({
      codex: PROVIDERS.codex?.modelEnvVar,
      claude: PROVIDERS.claude?.modelEnvVar,
      antigravity: PROVIDERS.antigravity?.modelEnvVar,
    }).toEqual({
      codex: "ASK_CODEX_MODEL",
      claude: "ASK_CLAUDE_MODEL",
      antigravity: "ASK_ANTIGRAVITY_MODEL",
    });
  });

  it("removes providers disabled by the current host environment", () => {
    const original = process.env.CLAUDECODE;
    try {
      delete process.env.CLAUDECODE;
      expect(getEligibleProviderKeys()).toContain("claude");
      process.env.CLAUDECODE = "1";
      expect(getEligibleProviderKeys()).not.toContain("claude");
    } finally {
      if (original === undefined) delete process.env.CLAUDECODE;
      else process.env.CLAUDECODE = original;
    }
  });

  it("removes host-disabled providers from diagnostic specs", async () => {
    const original = process.env.CLAUDECODE;
    try {
      process.env.CLAUDECODE = "1";
      const specs = await buildProviderSpecs();
      expect(specs.map(({ key }) => key)).not.toContain("claude");
    } finally {
      if (original === undefined) delete process.env.CLAUDECODE;
      else process.env.CLAUDECODE = original;
    }
  });

  it("wires Antigravity version support into diagnostic specs", async () => {
    const specs = await buildProviderSpecs();
    const antigravity = specs.find(({ key }) => key === "antigravity");
    const assessment = await antigravity?.assessVersion?.("agy 1.1.4", undefined);

    expect(assessment?.available).toBe(false);
    expect(assessment?.error).toContain("1.1.4");
    expect(assessment?.error).toContain("1.1.5");
    expect(assessment?.fix).toContain("Update Antigravity CLI");
  });
});
