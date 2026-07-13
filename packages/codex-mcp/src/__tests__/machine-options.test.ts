import { existsSync, readFileSync, statSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLI, MODELS } from "../constants.js";

vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return {
    ...actual,
    executeCommand: vi.fn(),
    Logger: {
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
  };
});

import { executeCommand, responseCache } from "@ask-llm/shared";
import { executeCodexCLI } from "../utils/codexExecutor.js";

const mockExecuteCommand = vi.mocked(executeCommand);
const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { verdict: { type: "string" } },
  required: ["verdict"],
};
const agentMessage = (text: string) =>
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } });

function getOutputSchemaPath(args: string[]): string {
  const flagIndex = args.indexOf(CLI.FLAGS.OUTPUT_SCHEMA);
  expect(flagIndex).toBeGreaterThanOrEqual(0);
  return args[flagIndex + 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  responseCache.clear();
  mockExecuteCommand.mockResolvedValue(agentMessage('{"verdict":"ok"}'));
});

describe("executeCodexCLI machine options", () => {
  it("keeps a small structured prompt out of argv and sends it through stdin", async () => {
    const prompt = "private structured review prompt";

    await executeCodexCLI({ prompt, sandbox: "read-only", outputSchema });

    const [, args, , , stdin] = mockExecuteCommand.mock.calls[0];
    expect(args).not.toContain(prompt);
    expect(stdin).toBe(prompt);
  });

  it("uses unique 0600 schema files with read-only sandbox and removes them after success", async () => {
    const observedPaths: string[] = [];
    mockExecuteCommand.mockImplementation(async (_command, args) => {
      const schemaPath = getOutputSchemaPath(args);
      observedPaths.push(schemaPath);
      expect(JSON.parse(readFileSync(schemaPath, "utf8"))).toEqual(outputSchema);
      expect(statSync(schemaPath).mode & 0o777).toBe(0o600);
      expect(args).toContain(CLI.FLAGS.SANDBOX_READ_ONLY);
      expect(args).not.toContain(CLI.FLAGS.SANDBOX_WORKSPACE_WRITE);
      return agentMessage('{"verdict":"ok"}');
    });

    await executeCodexCLI({ prompt: "classify", sandbox: "read-only", outputSchema });
    await executeCodexCLI({ prompt: "classify", sandbox: "read-only", outputSchema });

    expect(observedPaths).toHaveLength(2);
    expect(observedPaths[0]).not.toBe(observedPaths[1]);
    expect(observedPaths.every((schemaPath) => !existsSync(schemaPath))).toBe(true);
  });

  it("removes the temporary schema file after command failure", async () => {
    let observedPath: string | undefined;
    mockExecuteCommand.mockImplementationOnce(async (_command, args) => {
      observedPath = getOutputSchemaPath(args);
      expect(existsSync(observedPath)).toBe(true);
      throw new Error("command failed");
    });

    await expect(executeCodexCLI({ prompt: "classify", sandbox: "read-only", outputSchema })).rejects.toThrow(
      "command failed",
    );

    if (observedPath === undefined) throw new Error("Codex was not given an output schema path");
    expect(existsSync(observedPath)).toBe(false);
  });

  it("does not read a cached plain response for structured output", async () => {
    mockExecuteCommand
      .mockResolvedValueOnce(agentMessage("plain response"))
      .mockResolvedValueOnce(agentMessage('{"verdict":"structured"}'));

    await executeCodexCLI({ prompt: "same prompt" });
    const result = await executeCodexCLI({ prompt: "same prompt", sandbox: "read-only", outputSchema });

    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
    expect(result.response).toContain("structured");
  });

  it("does not write a structured response to the response cache", async () => {
    await executeCodexCLI({ prompt: "classify", sandbox: "read-only", outputSchema });

    expect(responseCache.size).toBe(0);
  });

  it("partitions response-cache entries by sandbox mode", async () => {
    mockExecuteCommand.mockResolvedValue(agentMessage("sandbox response"));

    await executeCodexCLI({ prompt: "same prompt", sandbox: "workspace-write" });
    await executeCodexCLI({ prompt: "same prompt", sandbox: "read-only" });

    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
    expect(mockExecuteCommand.mock.calls[0][1]).toContain(CLI.FLAGS.SANDBOX_WORKSPACE_WRITE);
    expect(mockExecuteCommand.mock.calls[1][1]).toContain(CLI.FLAGS.SANDBOX_READ_ONLY);
  });

  it("passes the same schema file and read-only sandbox to the quota fallback leg", async () => {
    const prompt = "private structured fallback prompt";
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockResolvedValueOnce(agentMessage('{"verdict":"fallback"}'));

    await executeCodexCLI({ prompt, sandbox: "read-only", outputSchema });

    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
    const primaryArgs = mockExecuteCommand.mock.calls[0][1];
    const fallbackArgs = mockExecuteCommand.mock.calls[1][1];
    const schemaPath = getOutputSchemaPath(primaryArgs);
    expect(getOutputSchemaPath(fallbackArgs)).toBe(schemaPath);
    expect(fallbackArgs).toContain(CLI.FLAGS.SANDBOX_READ_ONLY);
    expect(fallbackArgs).toContain(MODELS.FALLBACK);
    expect(primaryArgs).not.toContain(prompt);
    expect(fallbackArgs).not.toContain(prompt);
    expect(mockExecuteCommand.mock.calls[0][4]).toBe(prompt);
    expect(mockExecuteCommand.mock.calls[1][4]).toBe(prompt);
    expect(existsSync(schemaPath)).toBe(false);
  });

  it("keeps structured prompts on stdin through preferred, default, and fallback attempts", async () => {
    const prompt = "private structured preferred prompt";
    const originalPreferred = MODELS.PREFERRED;
    MODELS.PREFERRED = "test-structured-preferred";
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("preferred unavailable"))
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockResolvedValueOnce(agentMessage('{"verdict":"fallback"}'));

    try {
      await executeCodexCLI({ prompt, sandbox: "read-only", outputSchema, preferred: true });
    } finally {
      MODELS.PREFERRED = originalPreferred;
    }

    expect(mockExecuteCommand).toHaveBeenCalledTimes(3);
    for (const call of mockExecuteCommand.mock.calls) {
      expect(call[1]).not.toContain(prompt);
      expect(call[4]).toBe(prompt);
    }
  });
});
