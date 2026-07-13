import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_HOST_ENV_VAR, CLI, ERROR_MESSAGES, MODELS, READ_ONLY_SYSTEM_PROMPT } from "../../constants.js";

vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return {
    ...actual,
    executeCommand: vi.fn(),
  };
});

import { executeCommand } from "@ask-llm/shared";
import { buildArgs, executeClaudeCLI, parseClaudeJsonOutput } from "../claudeExecutor.js";

const mockExecuteCommand = vi.mocked(executeCommand);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ASK_CLAUDE_TIMEOUT_MS;
  delete process.env.GMCPT_TIMEOUT_MS;
  delete process.env[CLAUDE_HOST_ENV_VAR];
});

describe("buildArgs", () => {
  it("enforces safe mode and a read-only tool allow-list", () => {
    const args = buildArgs("opus", "sonnet");
    expect(args).toEqual([
      CLI.FLAGS.PRINT,
      CLI.FLAGS.OUTPUT_FORMAT,
      CLI.FLAGS.JSON,
      CLI.FLAGS.SAFE_MODE,
      CLI.FLAGS.TOOLS,
      CLI.FLAGS.READ_ONLY_TOOLS,
      CLI.FLAGS.PERMISSION_MODE,
      CLI.FLAGS.DONT_ASK,
      CLI.FLAGS.APPEND_SYSTEM_PROMPT,
      READ_ONLY_SYSTEM_PROMPT,
      CLI.FLAGS.MODEL,
      "opus",
      CLI.FLAGS.FALLBACK_MODEL,
      "sonnet",
    ]);
    expect(args.join(" ")).not.toMatch(/\b(?:Bash|Edit|Write)\b/);
  });

  it("adds relative context directories and a native resume id", () => {
    const args = buildArgs("sonnet", "sonnet", "session-1", ["packages/api", "apps/docs"]);
    expect(args).not.toContain(CLI.FLAGS.FALLBACK_MODEL);
    expect(args.slice(-6)).toEqual([
      CLI.FLAGS.ADD_DIR,
      "packages/api",
      CLI.FLAGS.ADD_DIR,
      "apps/docs",
      CLI.FLAGS.RESUME,
      "session-1",
    ]);
  });
});

describe("parseClaudeJsonOutput", () => {
  it("extracts the response, native session, actual model, and usage", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1234,
      result: "Independent review",
      session_id: "2b7f7c54-2f93-4d6e-a551-8f947ce73643",
      modelUsage: {
        "claude-opus-4-6": {
          inputTokens: 120,
          outputTokens: 45,
          cacheReadInputTokens: 80,
        },
      },
    });

    const parsed = parseClaudeJsonOutput(raw, "opus", 9999);
    expect(parsed).toMatchObject({
      response: "Independent review",
      model: "claude-opus-4-6",
      sessionId: "2b7f7c54-2f93-4d6e-a551-8f947ce73643",
      usage: {
        provider: "claude",
        model: "claude-opus-4-6",
        inputTokens: 120,
        outputTokens: 45,
        cachedTokens: 80,
        durationMs: 1234,
        fellBack: false,
      },
    });
  });

  it("reports a Sonnet fallback when Opus was requested", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "fallback answer",
      modelUsage: { "claude-sonnet-4-6": { inputTokens: 3, outputTokens: 2 } },
    });
    const parsed = parseClaudeJsonOutput(raw, "opus", 10);
    expect(parsed.model).toBe("claude-sonnet-4-6");
    expect(parsed.usage.fellBack).toBe(true);
  });

  it("uses aggregate snake_case usage when per-model usage is absent", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "answer",
      usage: { input_tokens: 7, output_tokens: 4, cache_read_input_tokens: 5 },
    });
    expect(parseClaudeJsonOutput(raw, "opus", 55).usage).toMatchObject({
      inputTokens: 7,
      outputTokens: 4,
      cachedTokens: 5,
      durationMs: 55,
    });
  });

  it("selects the model responsible for the most tokens", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "answer",
      modelUsage: {
        "claude-haiku-4-5": { inputTokens: 1, outputTokens: 1 },
        "claude-opus-4-6": { inputTokens: 100, outputTokens: 40 },
      },
    });
    expect(parseClaudeJsonOutput(raw, "opus", 1).model).toBe("claude-opus-4-6");
  });

  it("surfaces exit-zero Claude error results", () => {
    const raw = JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, result: "stopped" });
    expect(() => parseClaudeJsonOutput(raw, "opus", 1)).toThrow("Claude CLI error: stopped");
  });

  it("rejects malformed or empty result output", () => {
    expect(() => parseClaudeJsonOutput("not json", "opus", 1)).toThrow("valid JSON result");
    expect(() =>
      parseClaudeJsonOutput(JSON.stringify({ type: "result", subtype: "success", result: "" }), "opus", 1),
    ).toThrow("empty response");
  });
});

describe("executeClaudeCLI", () => {
  it("sends the prompt over stdin and returns parsed output", async () => {
    mockExecuteCommand.mockResolvedValue(
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "review",
        session_id: "session-2",
        modelUsage: { "claude-opus-4-6": { inputTokens: 2, outputTokens: 3 } },
      }),
    );
    const onProgress = vi.fn();

    const result = await executeClaudeCLI({ prompt: "review this", onProgress });

    expect(result.response).toBe("review");
    expect(mockExecuteCommand).toHaveBeenCalledOnce();
    expect(mockExecuteCommand.mock.calls[0][0]).toBe(CLI.COMMAND);
    expect(mockExecuteCommand.mock.calls[0][1]).toContain(MODELS.DEFAULT);
    expect(mockExecuteCommand.mock.calls[0][1]).not.toContain("review this");
    expect(mockExecuteCommand.mock.calls[0][2]).toBeUndefined();
    expect(mockExecuteCommand.mock.calls[0][4]).toBe("review this");
    expect(mockExecuteCommand.mock.calls[0][5]).toBeGreaterThan(0);
    expect(onProgress).toHaveBeenCalledWith("review");
  });

  it("honors the provider-specific timeout", async () => {
    process.env.ASK_CLAUDE_TIMEOUT_MS = "12345";
    mockExecuteCommand.mockResolvedValue(JSON.stringify({ type: "result", subtype: "success", result: "ok" }));
    await executeClaudeCLI({ prompt: "p" });
    expect(mockExecuteCommand.mock.calls[0][5]).toBe(12345);
  });

  it("rejects nested execution when the MCP host is Claude Code", async () => {
    process.env[CLAUDE_HOST_ENV_VAR] = "1";
    await expect(executeClaudeCLI({ prompt: "p" })).rejects.toThrow(ERROR_MESSAGES.NESTED_SESSION);
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });
});
