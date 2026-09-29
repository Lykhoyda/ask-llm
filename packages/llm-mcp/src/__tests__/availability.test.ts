import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "../constants.js";

describe("PROVIDERS registry", () => {
  it("registers antigravity as an agy-backed provider", () => {
    expect(PROVIDERS.antigravity).toBeDefined();
    expect(PROVIDERS.antigravity.command).toBe("agy");
    expect(PROVIDERS.antigravity.executorModule).toBe("@ask-llm/antigravity-mcp/executor");
    expect(PROVIDERS.antigravity.executorFn).toBe("executeAntigravityCLI");
  });

  it("registers Grok as an xAI API-backed provider", () => {
    expect(PROVIDERS.grok).toMatchObject({
      command: "xai-api",
      executorModule: "@ask-llm/grok-mcp/executor",
      executorFn: "executeGrok",
      defaultModel: "grok-4.7",
      modelEnvVar: "ASK_GROK_MODEL",
      availabilityFn: "isGrokProviderAvailable",
    });
  });

  it("registers Claude as a Claude Code CLI-backed provider", () => {
    expect(PROVIDERS.claude).toBeDefined();
    expect(PROVIDERS.claude.command).toBe("claude");
    expect(PROVIDERS.claude.executorModule).toBe("@ask-llm/claude-mcp/executor");
    expect(PROVIDERS.claude.executorFn).toBe("executeClaudeCLI");
    expect(PROVIDERS.claude.disabledWhenEnvVar).toBe("CLAUDECODE");
  });
});

describe("isCommandAvailable", () => {
  it("finds executable files on the shared spawn PATH without which", async () => {
    const bin = mkdtempSync(join(tmpdir(), "ask-llm-availability-"));
    const executable = join(bin, "gemini");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);
    vi.stubEnv("ASK_LLM_PATH", bin);
    vi.resetModules();
    try {
      const { isCommandAvailable, resolveCommand } = await import("../utils/availability.js");
      expect(await resolveCommand("gemini")).toBe(executable);
      expect(await isCommandAvailable("gemini")).toBe(true);
      expect(await isCommandAvailable("missing")).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
