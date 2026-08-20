import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => {
  const mockExecFile = vi.fn();
  return { execFile: mockExecFile };
});

import { execFile } from "node:child_process";
import { PROVIDERS } from "../constants.js";
import { isCommandAvailable } from "../utils/availability.js";

const mockExecFile = vi.mocked(execFile);

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
      defaultModel: "grok-4.6",
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
  it("returns true when command is found on PATH", async () => {
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, result: { stdout: string }) => void)(null, { stdout: "/usr/bin/gemini" });
      return undefined as never;
    });

    expect(await isCommandAvailable("gemini")).toBe(true);
  });

  it("returns false when command is not found", async () => {
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: Error) => void)(new Error("not found"));
      return undefined as never;
    });

    expect(await isCommandAvailable("nonexistent")).toBe(false);
  });

  it("passes command to which/where with timeout", async () => {
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, result: { stdout: string }) => void)(null, { stdout: "/usr/bin/test" });
      return undefined as never;
    });

    await isCommandAvailable("test-cmd");

    expect(mockExecFile).toHaveBeenCalledWith(
      expect.stringMatching(/which|where/),
      ["test-cmd"],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });
});
