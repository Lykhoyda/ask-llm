import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLI, CODEX_EDIT_SCHEMA, DEFAULT_REASONING_EFFORT, MODELS } from "../../constants.js";

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
import { executeCodexCLI, parseCodexEdits, processCodexEditOutput } from "../codexExecutor.js";

const mockExecuteCommand = vi.mocked(executeCommand);

beforeEach(() => {
  vi.clearAllMocks();
  responseCache.clear();
  mockExecuteCommand.mockResolvedValue("Codex response");
});

describe("executeCodexCLI argument construction", () => {
  it("uses 'exec' subcommand with correct flags", async () => {
    await executeCodexCLI({ prompt: "explain this code" });

    expect(mockExecuteCommand).toHaveBeenCalledOnce();
    const [cmd, args] = mockExecuteCommand.mock.calls[0];
    expect(cmd).toBe(CLI.COMMANDS.CODEX);
    expect(args[0]).toBe(CLI.COMMANDS.EXEC);
  });

  it("builds args with required flags and prompt as last positional", async () => {
    await executeCodexCLI({ prompt: "hello" });

    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).toEqual([
      CLI.COMMANDS.EXEC,
      CLI.FLAGS.SKIP_GIT,
      CLI.FLAGS.EPHEMERAL,
      CLI.FLAGS.IGNORE_USER_CONFIG,
      CLI.FLAGS.IGNORE_RULES,
      CLI.FLAGS.SANDBOX,
      CLI.FLAGS.SANDBOX_READ_ONLY,
      CLI.FLAGS.CONFIG,
      `model_reasoning_effort="${DEFAULT_REASONING_EFFORT}"`,
      CLI.FLAGS.JSON,
      CLI.FLAGS.MODEL,
      MODELS.DEFAULT,
      "hello",
    ]);
  });

  it("builds exact persisted-fresh argv when sessionId is empty", async () => {
    await executeCodexCLI({ prompt: "hello", sessionId: "" });

    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).toEqual([
      CLI.COMMANDS.EXEC,
      CLI.FLAGS.SKIP_GIT,
      CLI.FLAGS.IGNORE_USER_CONFIG,
      CLI.FLAGS.IGNORE_RULES,
      CLI.FLAGS.SANDBOX,
      CLI.FLAGS.SANDBOX_READ_ONLY,
      CLI.FLAGS.CONFIG,
      `model_reasoning_effort="${DEFAULT_REASONING_EFFORT}"`,
      CLI.FLAGS.JSON,
      CLI.FLAGS.MODEL,
      MODELS.DEFAULT,
      "hello",
    ]);
  });

  it("builds exact resume argv with stable sandbox config and excludes unsupported flags", async () => {
    await executeCodexCLI({ prompt: "hello", sessionId: "thread-abc-123", includeDirs: ["packages/api"] });

    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).toEqual([
      CLI.COMMANDS.EXEC,
      CLI.COMMANDS.RESUME,
      CLI.FLAGS.SKIP_GIT,
      CLI.FLAGS.IGNORE_USER_CONFIG,
      CLI.FLAGS.IGNORE_RULES,
      CLI.FLAGS.CONFIG,
      `sandbox_mode="${CLI.FLAGS.SANDBOX_READ_ONLY}"`,
      CLI.FLAGS.CONFIG,
      `model_reasoning_effort="${DEFAULT_REASONING_EFFORT}"`,
      CLI.FLAGS.JSON,
      CLI.FLAGS.MODEL,
      MODELS.DEFAULT,
      "thread-abc-123",
      "hello",
    ]);
    expect(args).not.toContain(CLI.FLAGS.SANDBOX);
    expect(args).not.toContain(CLI.FLAGS.ADD_DIR);
    expect(args).not.toContain(CLI.FLAGS.EPHEMERAL);
  });

  it("uses custom model when specified", async () => {
    await executeCodexCLI({ prompt: "hello", model: "o3" });

    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).toContain("o3");
    expect(args).not.toContain(MODELS.DEFAULT);
  });

  it("passes onProgress callback to executeCommand", async () => {
    const onProgress = vi.fn();
    await executeCodexCLI({ prompt: "hello", onProgress });

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      CLI.COMMANDS.CODEX,
      expect.any(Array),
      onProgress,
      undefined,
      undefined,
      expect.any(Number),
      undefined,
      undefined,
    );
  });

  it("forwards caller cancellation to executeCommand", async () => {
    const signal = new AbortController().signal;
    await executeCodexCLI({ prompt: "hello", signal });
    expect(mockExecuteCommand.mock.calls[0][7]).toBe(signal);
  });
});

describe("model pinning (#75)", () => {
  it("always passes -m <model> so codex never silently auto-resolves the model", async () => {
    await executeCodexCLI({ prompt: "x" });
    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).toContain(CLI.FLAGS.MODEL);
    expect(args[args.indexOf(CLI.FLAGS.MODEL) + 1]).toBe(MODELS.DEFAULT);
  });
});

describe("reasoning effort", () => {
  it("passes the behavior-preserving medium default as a per-call config override", async () => {
    await executeCodexCLI({ prompt: "x" });
    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args[args.indexOf(CLI.FLAGS.CONFIG) + 1]).toBe('model_reasoning_effort="medium"');
  });

  it("passes an explicit high effort to Codex", async () => {
    await executeCodexCLI({ prompt: "review", reasoningEffort: "high" });
    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args[args.indexOf(CLI.FLAGS.CONFIG) + 1]).toBe('model_reasoning_effort="high"');
  });

  it("partitions response-cache entries by reasoning effort", async () => {
    mockExecuteCommand.mockResolvedValue('{"type":"item.completed","item":{"type":"agent_message","text":"R"}}');
    await executeCodexCLI({ prompt: "same prompt", reasoningEffort: "medium" });
    await executeCodexCLI({ prompt: "same prompt", reasoningEffort: "high" });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });
});

describe("includeDirs → --add-dir (#59)", () => {
  it("maps includeDirs to one --add-dir flag per directory", async () => {
    await executeCodexCLI({ prompt: "x", includeDirs: ["/repo/pkg-a", "/repo/pkg-b"] });
    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).toContain("/repo/pkg-a");
    expect(args).toContain("/repo/pkg-b");
    expect(args.filter((a) => a === CLI.FLAGS.ADD_DIR)).toHaveLength(2);
  });

  it("preserves includeDirs in the fallback invocation", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockResolvedValueOnce('{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}');

    await executeCodexCLI({ prompt: "x", includeDirs: ["/repo/pkg-a"] });
    const [, fallbackArgs] = mockExecuteCommand.mock.calls[1];
    expect(fallbackArgs).toContain(CLI.FLAGS.ADD_DIR);
    expect(fallbackArgs).toContain("/repo/pkg-a");
  });

  // includeDirs is context-affecting, so it must be part of the response cache
  // key — otherwise the same prompt+model with different dirs serves a stale
  // answer that ignored the new context. (Found in /multi-review by Codex.)
  it("does not serve a cached response across different includeDirs", async () => {
    mockExecuteCommand.mockResolvedValue('{"type":"item.completed","item":{"type":"agent_message","text":"R"}}');
    await executeCodexCLI({ prompt: "same prompt", includeDirs: ["/a"] });
    await executeCodexCLI({ prompt: "same prompt", includeDirs: ["/b"] });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });

  it("still serves the cache when prompt, model, and includeDirs all match", async () => {
    mockExecuteCommand.mockResolvedValue('{"type":"item.completed","item":{"type":"agent_message","text":"R"}}');
    await executeCodexCLI({ prompt: "same prompt", includeDirs: ["/a"] });
    await executeCodexCLI({ prompt: "same prompt", includeDirs: ["/a"] });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
  });
});

describe("JSONL output parsing", () => {
  it("extracts agent_message text from item.completed event", async () => {
    mockExecuteCommand.mockResolvedValue(
      [
        '{"type":"thread.started","thread_id":"abc-123"}',
        '{"type":"turn.started"}',
        '{"type":"item.completed","item":{"type":"agent_message","text":"The code looks good."}}',
        '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":50}}',
      ].join("\n"),
    );

    const result = await executeCodexCLI({ prompt: "review this" });
    expect(result.response).toContain("The code looks good.");
    expect(result.threadId).toBe("abc-123");
  });

  it("selects the LAST agent_message when multiple present", async () => {
    mockExecuteCommand.mockResolvedValue(
      [
        '{"type":"item.completed","item":{"type":"agent_message","text":"First message"}}',
        '{"type":"item.completed","item":{"type":"agent_message","text":"Final answer"}}',
      ].join("\n"),
    );

    const result = await executeCodexCLI({ prompt: "review this" });
    expect(result.response).toContain("Final answer");
    expect(result.response).not.toContain("First message");
  });

  it("skips non-agent_message item types", async () => {
    mockExecuteCommand.mockResolvedValue(
      [
        '{"type":"item.completed","item":{"type":"command_execution","command":"ls"}}',
        '{"type":"item.completed","item":{"type":"agent_message","text":"Here are the files."}}',
      ].join("\n"),
    );

    const result = await executeCodexCLI({ prompt: "list files" });
    expect(result.response).toContain("Here are the files.");
  });

  it("skips malformed JSON lines gracefully", async () => {
    mockExecuteCommand.mockResolvedValue(
      ["not json at all", '{"type":"item.completed","item":{"type":"agent_message","text":"Valid response"}}'].join(
        "\n",
      ),
    );

    const result = await executeCodexCLI({ prompt: "test" });
    expect(result.response).toContain("Valid response");
  });

  it("returns raw text when output contains no parseable JSONL at all (plain-text mode)", async () => {
    mockExecuteCommand.mockResolvedValue("Plain text output with no JSON");

    const result = await executeCodexCLI({ prompt: "test" });
    expect(result.response).toBe("Plain text output with no JSON");
  });

  it("throws an actionable error when JSONL events parse but contain no agent message", async () => {
    mockExecuteCommand.mockResolvedValue(
      [
        '{"type":"thread.started","thread_id":"th_123"}',
        '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":0}}',
      ].join("\n"),
    );

    await expect(executeCodexCLI({ prompt: "test" })).rejects.toThrow(
      /completed without an agent message[\s\S]*th_123/,
    );
  });

  it("includes token stats from turn.completed in response", async () => {
    mockExecuteCommand.mockResolvedValue(
      [
        '{"type":"item.completed","item":{"type":"agent_message","text":"Analysis complete."}}',
        '{"type":"turn.completed","usage":{"input_tokens":5000,"output_tokens":200,"cached_input_tokens":4500}}',
      ].join("\n"),
    );

    const result = await executeCodexCLI({ prompt: "analyze" });
    expect(result.response).toContain("5,000 input tokens");
    expect(result.response).toContain("200 output tokens");
    expect(result.response).toContain("4,500 cached");
  });

  it("surfaces reasoning_output_tokens in stats footer + UsageStats.thinkingTokens (codex 0.125+)", async () => {
    mockExecuteCommand.mockResolvedValue(
      [
        '{"type":"item.completed","item":{"type":"agent_message","text":"Reasoned answer."}}',
        '{"type":"turn.completed","usage":{"input_tokens":1000,"output_tokens":50,"reasoning_output_tokens":7500}}',
      ].join("\n"),
    );

    const result = await executeCodexCLI({ prompt: "think hard" });

    // Footer surfaces the new field with comma formatting, matching the Gemini convention.
    expect(result.response).toContain("7,500 thinking tokens");
    // UsageStats.thinkingTokens carries the value for cross-provider aggregation
    // in get-usage-stats and formatSessionUsage.
    expect(result.usage?.thinkingTokens).toBe(7500);
  });

  it("omits thinking tokens line when reasoning_output_tokens is zero (non-reasoning model)", async () => {
    mockExecuteCommand.mockResolvedValue(
      [
        '{"type":"item.completed","item":{"type":"agent_message","text":"Quick answer."}}',
        '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":20,"reasoning_output_tokens":0}}',
      ].join("\n"),
    );

    const result = await executeCodexCLI({ prompt: "quick" });

    expect(result.response).not.toContain("thinking tokens");
    // Zero is preserved in UsageStats (telemetry caller may want the explicit 0)
    expect(result.usage?.thinkingTokens).toBe(0);
  });

  it("treats missing reasoning_output_tokens as undefined (older codex versions)", async () => {
    mockExecuteCommand.mockResolvedValue(
      [
        '{"type":"item.completed","item":{"type":"agent_message","text":"Old codex answer."}}',
        '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":20}}',
      ].join("\n"),
    );

    const result = await executeCodexCLI({ prompt: "old" });

    expect(result.response).not.toContain("thinking tokens");
    expect(result.usage?.thinkingTokens).toBeUndefined();
  });

  it("extracts thread_id from thread.started event", async () => {
    mockExecuteCommand.mockResolvedValue(
      [
        '{"type":"thread.started","thread_id":"thread-uuid-456"}',
        '{"type":"item.completed","item":{"type":"agent_message","text":"Done."}}',
      ].join("\n"),
    );

    const result = await executeCodexCLI({ prompt: "test" });
    expect(result.threadId).toBe("thread-uuid-456");
  });

  it("throws on error events when no agent_message present", async () => {
    mockExecuteCommand.mockResolvedValue('{"type":"error","message":"Something went wrong"}');

    await expect(executeCodexCLI({ prompt: "test" })).rejects.toThrow("Codex error event");
  });

  it("returns agent_message even when error event is also present", async () => {
    mockExecuteCommand.mockResolvedValue(
      [
        '{"type":"item.completed","item":{"type":"agent_message","text":"Partial answer before error"}}',
        '{"type":"error","message":"Non-fatal tool error"}',
      ].join("\n"),
    );

    const result = await executeCodexCLI({ prompt: "test" });
    expect(result.response).toContain("Partial answer before error");
  });

  // #114 §3.1 — turn.failed (codex rust-v0.131.0+) was unhandled: a failed turn
  // with no agent_message silently returned the raw JSONL dump as the response.
  it("throws on turn.failed events, extracting error.message", async () => {
    mockExecuteCommand.mockResolvedValue(
      [
        '{"type":"thread.started","thread_id":"t1"}',
        '{"type":"turn.failed","error":{"message":"context deadline exceeded"}}',
      ].join("\n"),
    );

    await expect(executeCodexCLI({ prompt: "test" })).rejects.toThrow("context deadline exceeded");
  });

  // #114 §3.2 — error event surfaced the JSON envelope instead of the message field.
  it("surfaces the error event's message field, not the JSON envelope", async () => {
    mockExecuteCommand.mockResolvedValue('{"type":"error","message":"You are out of quota"}');

    await expect(executeCodexCLI({ prompt: "test" })).rejects.toThrow("Codex error event: You are out of quota");
  });
});

describe("quota fallback", () => {
  it("retries with fallback model on rate_limit_exceeded error", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockResolvedValueOnce('{"type":"item.completed","item":{"type":"agent_message","text":"Fallback response"}}');

    const result = await executeCodexCLI({ prompt: "test", reasoningEffort: "high" });
    expect(result.response).toContain("Fallback response");
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);

    const [, fallbackArgs] = mockExecuteCommand.mock.calls[1];
    expect(fallbackArgs).toContain(MODELS.FALLBACK);
    expect(fallbackArgs[fallbackArgs.indexOf(CLI.FLAGS.CONFIG) + 1]).toBe('model_reasoning_effort="high"');
  });

  it("retries with fallback model on 429 error", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("HTTP 429 Too Many Requests"))
      .mockResolvedValueOnce('{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}');

    const result = await executeCodexCLI({ prompt: "test" });
    expect(result.response).toContain("OK");
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });

  it("retries with fallback model on insufficient_quota error", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("insufficient_quota"))
      .mockResolvedValueOnce('{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}');

    const result = await executeCodexCLI({ prompt: "test" });
    expect(result.response).toContain("OK");
  });

  it("does not retry if already using fallback model", async () => {
    mockExecuteCommand.mockRejectedValueOnce(new Error("rate_limit_exceeded"));

    await expect(executeCodexCLI({ prompt: "test", model: MODELS.FALLBACK })).rejects.toThrow("rate_limit_exceeded");
    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
  });

  it("throws combined error when both models fail", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockRejectedValueOnce(new Error("still failing"));

    await expect(executeCodexCLI({ prompt: "test" })).rejects.toThrow(
      `${MODELS.DEFAULT} quota exceeded, ${MODELS.FALLBACK} fallback also failed: still failing`,
    );
  });

  // #102 §3.2 — point users at `codex doctor` when the whole fallback chain fails.
  it("suggests `codex doctor` when both models fail", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockRejectedValueOnce(new Error("still failing"));

    await expect(executeCodexCLI({ prompt: "test" })).rejects.toThrow(/codex doctor/);
  });

  it("re-throws non-quota errors without retry", async () => {
    mockExecuteCommand.mockRejectedValueOnce(new Error("ENOENT: codex not found"));

    await expect(executeCodexCLI({ prompt: "test" })).rejects.toThrow("ENOENT: codex not found");
    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
  });

  // #114 — a quota signal delivered via turn.failed (rather than a thrown CLI
  // error) must still trigger the fallback, not return the raw JSONL dump.
  it("falls back when a turn.failed event carries a quota signal", async () => {
    mockExecuteCommand
      .mockResolvedValueOnce('{"type":"turn.failed","error":{"message":"rate_limit_exceeded: usage cap hit"}}')
      .mockResolvedValueOnce('{"type":"item.completed","item":{"type":"agent_message","text":"Recovered"}}');

    const result = await executeCodexCLI({ prompt: "test" });
    expect(result.response).toContain("Recovered");
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
    const [, fallbackArgs] = mockExecuteCommand.mock.calls[1];
    expect(fallbackArgs).toContain(MODELS.FALLBACK);
  });

  // #127 — codex 0.134 PR #24114 added workspace credit/spend-cap usage-limit
  // messages. They must trigger the same fallback as rate_limit_exceeded.
  it("falls back on a codex 0.134 workspace credit-depletion error", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("Your workspace is out of credits. Add credits to continue."))
      .mockResolvedValueOnce('{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}');

    const result = await executeCodexCLI({ prompt: "test" });
    expect(result.response).toContain("OK");
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });

  it("falls back on a codex 0.134 workspace spend-cap error", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(
        new Error("You hit your spend cap set in your workspace. Increase your spend cap to continue."),
      )
      .mockResolvedValueOnce('{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}');

    const result = await executeCodexCLI({ prompt: "test" });
    expect(result.response).toContain("OK");
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });
});

// #196 / ADR-126 follow-up: a user can pin an incompatible model via
// ASK_CODEX_FALLBACK_MODEL (e.g. gpt-5.5-mini on a ChatGPT-plan account). When
// the primary hits quota AND that pinned fallback fails structurally (a 400, not
// a quota), the ladder is broken — surface an actionable message naming the
// offending model and the env var to fix, NOT the generic "fallback also failed".
describe("fallback model structurally unavailable for the account (#196)", () => {
  it("surfaces an actionable message naming the fallback model and ASK_CODEX_FALLBACK_MODEL", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockRejectedValueOnce(new Error("400 The model is not supported when using Codex with a ChatGPT account."));

    const err = await executeCodexCLI({ prompt: "test" }).catch((e) => e as Error);
    expect(err.message).toContain(MODELS.FALLBACK);
    expect(err.message).toMatch(/ASK_CODEX_FALLBACK_MODEL/);
    expect(err.message).toMatch(/account/i);
    // Must NOT degrade to the generic both-failed / codex-doctor message.
    expect(err.message).not.toMatch(/fallback also failed/);
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });

  it("still uses the generic both-failed message when the fallback fails for an unrelated reason", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockRejectedValueOnce(new Error("network blip"));

    const err = await executeCodexCLI({ prompt: "test" }).catch((e) => e as Error);
    expect(err.message).toMatch(/fallback also failed: network blip/);
    expect(err.message).toMatch(/codex doctor/);
  });

  // PR #198 review (claude-review, finding 1): the actionable message must not
  // assume its own trigger. The branch fires for ANY fallback 400, but "unset it
  // to use the default" only makes sense when the user PINNED an incompatible
  // model. With no pin, the failing model IS the default — telling the user to
  // unset back to it is self-contradictory.
  describe("remediation wording adapts to whether the fallback was user-pinned", () => {
    let originalPin: string | undefined;

    beforeEach(() => {
      originalPin = process.env.ASK_CODEX_FALLBACK_MODEL;
      delete process.env.ASK_CODEX_FALLBACK_MODEL;
    });

    afterEach(() => {
      if (originalPin === undefined) delete process.env.ASK_CODEX_FALLBACK_MODEL;
      else process.env.ASK_CODEX_FALLBACK_MODEL = originalPin;
    });

    it("does NOT tell the user to unset/use-the-default when no fallback is pinned", async () => {
      mockExecuteCommand
        .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
        .mockRejectedValueOnce(new Error("400 The model is not supported when using Codex with a ChatGPT account."));

      const err = await executeCodexCLI({ prompt: "test" }).catch((e) => e as Error);
      // Still actionable…
      expect(err.message).toMatch(/ASK_CODEX_FALLBACK_MODEL/);
      expect(err.message).toMatch(/account/i);
      // …but no self-contradictory "unset it to use the default" — there is no pin.
      expect(err.message).not.toMatch(/unset/i);
    });

    it("offers to unset back to the default when an incompatible fallback IS pinned", async () => {
      process.env.ASK_CODEX_FALLBACK_MODEL = "gpt-5.5-mini";
      mockExecuteCommand
        .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
        .mockRejectedValueOnce(new Error("400 The model is not supported when using Codex with a ChatGPT account."));

      const err = await executeCodexCLI({ prompt: "test" }).catch((e) => e as Error);
      expect(err.message).toMatch(/unset it to use the default/i);
      expect(err.message).toMatch(/gpt-5\.6-terra/);
    });
  });
});

describe("session continuity (ADR-058 hardening per ADR-063)", () => {
  it("disables response cache when sessionId is the empty string (ADR-063 fix)", async () => {
    responseCache.clear();
    await executeCodexCLI({ prompt: "x" });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);

    await executeCodexCLI({ prompt: "x", sessionId: "" });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });
});

describe("executeCodexCLI stdin path for large prompts (#30)", () => {
  it("keeps small prompts in argv (15 KiB → positional argv)", async () => {
    const prompt = "x".repeat(15_360);
    await executeCodexCLI({ prompt });

    const [, args, , , stdin] = mockExecuteCommand.mock.calls[0];
    expect(args).toContain(prompt);
    expect(stdin).toBeUndefined();
  });

  it("flips to stdin path above the 16 KiB threshold (17 KiB → stdin)", async () => {
    const prompt = "y".repeat(17_408);
    await executeCodexCLI({ prompt });

    const [, args, , , stdin] = mockExecuteCommand.mock.calls[0];
    expect(args).not.toContain(prompt);
    expect(args[args.length - 1]).toBe(MODELS.DEFAULT);
    expect(stdin).toBe(prompt);
  });

  it("preserves stdin path on quota fallback to mini", async () => {
    const prompt = "z".repeat(20_000);
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockResolvedValueOnce(
        [
          '{"type":"thread.started","thread_id":"abc"}',
          '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}',
        ].join("\n"),
      );

    await executeCodexCLI({ prompt });

    const [, fallbackArgs, , , fallbackStdin] = mockExecuteCommand.mock.calls[1];
    expect(fallbackArgs).not.toContain(prompt);
    expect(fallbackArgs).toContain(MODELS.FALLBACK);
    expect(fallbackStdin).toBe(prompt);
  });
});

describe("executeCodexCLI ASK_CODEX_LOAD_USER_CONFIG opt-out (#31 follow-up)", () => {
  let originalLoadUserConfig: string | undefined;

  beforeEach(() => {
    originalLoadUserConfig = process.env.ASK_CODEX_LOAD_USER_CONFIG;
    delete process.env.ASK_CODEX_LOAD_USER_CONFIG;
  });

  afterEach(() => {
    if (originalLoadUserConfig === undefined) delete process.env.ASK_CODEX_LOAD_USER_CONFIG;
    else process.env.ASK_CODEX_LOAD_USER_CONFIG = originalLoadUserConfig;
  });

  it("emits --ignore-user-config + --ignore-rules by default (env unset)", async () => {
    await executeCodexCLI({ prompt: "hello" });

    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).toContain(CLI.FLAGS.IGNORE_USER_CONFIG);
    expect(args).toContain(CLI.FLAGS.IGNORE_RULES);
  });

  it("omits --ignore-user-config + --ignore-rules when ASK_CODEX_LOAD_USER_CONFIG=1", async () => {
    process.env.ASK_CODEX_LOAD_USER_CONFIG = "1";

    await executeCodexCLI({ prompt: "hello" });

    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).not.toContain(CLI.FLAGS.IGNORE_USER_CONFIG);
    expect(args).not.toContain(CLI.FLAGS.IGNORE_RULES);
    expect(args).toEqual([
      CLI.COMMANDS.EXEC,
      CLI.FLAGS.SKIP_GIT,
      CLI.FLAGS.EPHEMERAL,
      CLI.FLAGS.SANDBOX,
      CLI.FLAGS.SANDBOX_READ_ONLY,
      CLI.FLAGS.CONFIG,
      `model_reasoning_effort="${DEFAULT_REASONING_EFFORT}"`,
      CLI.FLAGS.JSON,
      CLI.FLAGS.MODEL,
      MODELS.DEFAULT,
      "hello",
    ]);
  });

  it("opt-out also applies on session resume", async () => {
    process.env.ASK_CODEX_LOAD_USER_CONFIG = "1";

    await executeCodexCLI({ prompt: "hello", sessionId: "thread-abc-123" });

    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).not.toContain(CLI.FLAGS.IGNORE_USER_CONFIG);
    expect(args).not.toContain(CLI.FLAGS.IGNORE_RULES);
  });

  it("requires literal '1' — other truthy strings keep the deterministic default", async () => {
    process.env.ASK_CODEX_LOAD_USER_CONFIG = "true";

    await executeCodexCLI({ prompt: "hello" });

    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).toContain(CLI.FLAGS.IGNORE_USER_CONFIG);
    expect(args).toContain(CLI.FLAGS.IGNORE_RULES);
  });
});

describe("executeCodexCLI per-provider timeout (#45)", () => {
  // These tests pin the timeout-resolution policy at the executor boundary so
  // it survives refactors. They mirror resolveTimeoutMs's unit tests but at the
  // higher level (via the actual executor) — without these, swapping the
  // resolver helper for a hardcoded 210s would silently regress #45.

  let originalCodex: string | undefined;
  let originalGlobal: string | undefined;

  beforeEach(() => {
    originalCodex = process.env.ASK_CODEX_TIMEOUT_MS;
    originalGlobal = process.env.GMCPT_TIMEOUT_MS;
    delete process.env.ASK_CODEX_TIMEOUT_MS;
    delete process.env.GMCPT_TIMEOUT_MS;
  });

  afterEach(() => {
    if (originalCodex === undefined) delete process.env.ASK_CODEX_TIMEOUT_MS;
    else process.env.ASK_CODEX_TIMEOUT_MS = originalCodex;
    if (originalGlobal === undefined) delete process.env.GMCPT_TIMEOUT_MS;
    else process.env.GMCPT_TIMEOUT_MS = originalGlobal;
  });

  it("passes 800_000ms (codex default) to executeCommand when no env vars are set", async () => {
    await executeCodexCLI({ prompt: "hello" });

    const call = mockExecuteCommand.mock.calls[0];
    // Positional arg #6 (0-indexed 5) is the timeoutMs parameter.
    expect(call[5]).toBe(800_000);
  });

  it("uses GMCPT_TIMEOUT_MS when set", async () => {
    process.env.GMCPT_TIMEOUT_MS = "300000";

    await executeCodexCLI({ prompt: "hello" });

    expect(mockExecuteCommand.mock.calls[0][5]).toBe(300_000);
  });

  it("ASK_CODEX_TIMEOUT_MS takes precedence over GMCPT_TIMEOUT_MS", async () => {
    process.env.GMCPT_TIMEOUT_MS = "300000";
    process.env.ASK_CODEX_TIMEOUT_MS = "900000";

    await executeCodexCLI({ prompt: "hello" });

    expect(mockExecuteCommand.mock.calls[0][5]).toBe(900_000);
  });

  it("propagates the same timeout through the quota-fallback retry path", async () => {
    process.env.ASK_CODEX_TIMEOUT_MS = "900000";
    mockExecuteCommand.mockRejectedValueOnce(new Error("rate_limit_exceeded")).mockResolvedValueOnce("Codex response");

    await executeCodexCLI({ prompt: "hello" });

    // First call: primary model, second call: fallback model — both must use
    // the same resolved timeout. A regression where the fallback path drops
    // the param is silent in production until someone hits a quota error.
    expect(mockExecuteCommand.mock.calls[0][5]).toBe(900_000);
    expect(mockExecuteCommand.mock.calls[1][5]).toBe(900_000);
  });
});

describe("ask-codex-edit / editMode (#102)", () => {
  it("parseCodexEdits maps schema JSON to ChangeModeEdit[] with computed line ranges", () => {
    const json = JSON.stringify({
      edits: [
        { file: "src/a.ts", startLine: 10, oldCode: "const x = 1;", newCode: "const x = 2;", description: "bump" },
        { file: "src/b.ts", oldCode: "foo()\nbar()", newCode: "baz()" },
      ],
    });
    const edits = parseCodexEdits(json);
    expect(edits).toHaveLength(2);
    expect(edits[0]).toMatchObject({
      filename: "src/a.ts",
      oldStartLine: 10,
      oldCode: "const x = 1;",
      newCode: "const x = 2;",
    });
    expect(edits[0].oldEndLine).toBe(10);
    // startLine defaults to 1 when codex omits it
    expect(edits[1].oldStartLine).toBe(1);
    // multi-line oldCode → end line spans the lines
    expect(edits[1].oldEndLine).toBe(2);
  });

  it("parseCodexEdits returns [] for an empty edit set", () => {
    expect(parseCodexEdits(JSON.stringify({ edits: [] }))).toEqual([]);
  });

  it("processCodexEditOutput formats edits as applyable CHANGEMODE output", () => {
    const json = JSON.stringify({ edits: [{ file: "src/a.ts", startLine: 1, oldCode: "a", newCode: "b" }] });
    const out = processCodexEditOutput(json);
    expect(out).toContain("src/a.ts");
    expect(out).toMatch(/Replace this exact text|CHANGEMODE/);
  });

  it("processCodexEditOutput returns a friendly message when codex proposes no edits", () => {
    expect(processCodexEditOutput(JSON.stringify({ edits: [] }))).toMatch(/no edits/i);
  });

  it("all Codex calls use a read-only sandbox; editMode additionally uses --output-schema", async () => {
    mockExecuteCommand.mockResolvedValue(
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"edits\\":[]}"}}',
    );
    await executeCodexCLI({ prompt: "fix it", editMode: true });
    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).toContain(CLI.FLAGS.OUTPUT_SCHEMA);
    expect(args).toContain(CLI.FLAGS.SANDBOX_READ_ONLY);
    expect(args).not.toContain("workspace-write");
  });

  it("editMode still falls back to the fallback model on quota errors", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockResolvedValueOnce('{"type":"item.completed","item":{"type":"agent_message","text":"{\\"edits\\":[]}"}}');
    await executeCodexCLI({ prompt: "fix it", editMode: true });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
    const [, fallbackArgs] = mockExecuteCommand.mock.calls[1];
    expect(fallbackArgs).toContain(MODELS.FALLBACK);
    expect(fallbackArgs).toContain(CLI.FLAGS.OUTPUT_SCHEMA);
  });

  // /multi-review (Codex, 95): the executor appends "[Codex stats: ...]" to the
  // agent_message, so editMode JSON arrives with a trailing footer — parseCodexEdits
  // must still recover the edits (extract the JSON object), not return "no edits".
  it("parseCodexEdits extracts the JSON object even with a trailing stats footer", () => {
    const withFooter =
      '{"edits":[{"file":"a.ts","startLine":1,"oldCode":"a","newCode":"b"}]}\n\n[Codex stats: 100 input tokens]';
    const edits = parseCodexEdits(withFooter);
    expect(edits).toHaveLength(1);
    expect(edits[0].filename).toBe("a.ts");
  });

  // /multi-review (Codex, 85): schema JSON carries exact bytes, so trimming
  // oldCode/newCode would corrupt exact-match search/replace.
  it("parseCodexEdits preserves exact bytes (no trimming) for exact-match fidelity", () => {
    const json = JSON.stringify({ edits: [{ file: "a.ts", oldCode: "x  ", newCode: "y\n" }] });
    const edits = parseCodexEdits(json);
    expect(edits[0].oldCode).toBe("x  ");
    expect(edits[0].newCode).toBe("y\n");
  });

  // /multi-review (Codex, 80): the cache marker must be unambiguous — a literal
  // includeDir of "edit" must not collide with edit-mode's cache partition.
  it("editMode and a literal 'edit' includeDir do not share a cache entry", async () => {
    mockExecuteCommand.mockResolvedValue(
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"edits\\":[]}"}}',
    );
    await executeCodexCLI({ prompt: "p", editMode: true });
    await executeCodexCLI({ prompt: "p", includeDirs: ["edit"] });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });

  // Live smoke caught this: OpenAI strict structured-output (response_format)
  // rejects the schema unless `required` lists EVERY property (optionals are
  // nullable). Guard the invariant so it can't regress without a live call.
  it("CODEX_EDIT_SCHEMA lists every edit property in required (OpenAI strict mode)", () => {
    const item = CODEX_EDIT_SCHEMA.properties.edits.items;
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
  });
});

// codex 0.136 introduced archived sessions; `codex exec resume <id>` against an
// archived session fails. Translate it to an actionable error and do NOT fall
// back to the mini model (the session is still archived after a retry). #139 / #141 F1.
describe("executeCodexCLI session-continuity errors", () => {
  // beforeEach already runs vi.clearAllMocks() + sets a default resolved value,
  // so no per-test mockReset() is needed; mockRejectedValueOnce overrides for
  // the single call these tests make.
  it("archived-session error on resume (rollout-path signal) → actionable message, no mini fallback", async () => {
    mockExecuteCommand.mockRejectedValueOnce(
      new Error("Failed to resume session from ~/.codex/archived_sessions/rollout-2026-06-05.jsonl"),
    );
    const err = await executeCodexCLI({ prompt: "follow up", sessionId: "thread-xyz" }).catch((e) => e as Error);
    expect(err.message).toMatch(/session thread-xyz is archived/i);
    expect(err.message).toMatch(/codex unarchive thread-xyz/);
    expect(mockExecuteCommand).toHaveBeenCalledTimes(1); // no mini fallback
  });

  it("matches the prose 'session is archived' signal too (not just the rollout path)", async () => {
    mockExecuteCommand.mockRejectedValueOnce(new Error("error: session is archived"));
    const err = await executeCodexCLI({ prompt: "follow up", sessionId: "thread-xyz" }).catch((e) => e as Error);
    expect(err.message).toMatch(/session thread-xyz is archived/i);
    expect(err.message).toMatch(/codex unarchive thread-xyz/);
  });

  it("archived signal without a sessionId is not special-cased (no false trigger)", async () => {
    mockExecuteCommand.mockRejectedValueOnce(new Error("unrelated archived_sessions mention"));
    const err = await executeCodexCLI({ prompt: "hi" }).catch((e) => e as Error);
    expect(err.message).not.toMatch(/codex unarchive/i);
  });

  it("classifies no-rollout as continuity failure with persisted-first-turn guidance and no fallback", async () => {
    mockExecuteCommand.mockRejectedValueOnce(
      new Error("thread/resume failed: no rollout found for thread id thread-xyz (code -32600)"),
    );

    const err = await executeCodexCLI({ prompt: "follow up", sessionId: "thread-xyz" }).catch((e) => e as Error);

    expect(err.message).toMatch(/session thread-xyz has no persisted rollout/i);
    expect(err.message).toContain('sessionId: ""');
    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
  });

  it("classifies no-rollout from quota fallback as continuity failure", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockRejectedValueOnce(new Error("no rollout found for thread id thread-xyz"));

    const err = await executeCodexCLI({ prompt: "follow up", sessionId: "thread-xyz" }).catch((e) => e as Error);

    expect(err.message).toMatch(/session thread-xyz has no persisted rollout/i);
    expect(err.message).toContain('sessionId: ""');
    expect(err.message).not.toMatch(/fallback also failed|codex doctor/i);
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });
});

describe("configured preferred model tier", () => {
  const defaultPreferred = MODELS.PREFERRED;
  const AGENT = (t: string) => `{"type":"item.completed","item":{"type":"agent_message","text":"${t}"}}`;
  const modelOf = (call: number) => {
    const [, args] = mockExecuteCommand.mock.calls[call];
    return args[args.indexOf(CLI.FLAGS.MODEL) + 1];
  };

  beforeEach(() => {
    // GPT-5.6 Sol is both DEFAULT and PREFERRED out of the box. Give the legacy
    // escape hatch a distinct value so this suite continues to exercise its
    // opt-in downgrade and cache-isolation behavior.
    MODELS.PREFERRED = "test-preferred-model";
  });

  afterEach(() => {
    MODELS.PREFERRED = defaultPreferred;
  });

  it("runs MODELS.PREFERRED when preferred:true and it succeeds (no downgrade)", async () => {
    mockExecuteCommand.mockResolvedValueOnce(AGENT("pro answer"));
    const result = await executeCodexCLI({ prompt: "review", preferred: true, reasoningEffort: "high" });
    expect(mockExecuteCommand).toHaveBeenCalledOnce();
    expect(modelOf(0)).toBe(MODELS.PREFERRED);
    expect(result.response).toContain("pro answer");
    expect(result.usage?.model).toBe(MODELS.PREFERRED);
    expect(result.usage?.fellBack).toBe(false);
    const [, preferredArgs] = mockExecuteCommand.mock.calls[0];
    expect(preferredArgs[preferredArgs.indexOf(CLI.FLAGS.CONFIG) + 1]).toBe('model_reasoning_effort="high"');
  });

  it("downgrades to DEFAULT on an ARBITRARY (non-quota, non-signal) preferred failure", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("some totally unrecognized model access error"))
      .mockResolvedValueOnce(AGENT("default answer"));
    const result = await executeCodexCLI({ prompt: "review", preferred: true });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
    expect(modelOf(0)).toBe(MODELS.PREFERRED);
    expect(modelOf(1)).toBe(MODELS.DEFAULT);
    expect(result.response).toContain("default answer");
    expect(result.usage?.model).toBe(MODELS.DEFAULT);
    expect(result.usage?.fellBack).toBe(true);
  });

  it("full ladder: preferred quota → default quota → mini", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockResolvedValueOnce(AGENT("mini answer"));
    const result = await executeCodexCLI({ prompt: "review", preferred: true });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(3);
    expect([modelOf(0), modelOf(1), modelOf(2)]).toEqual([MODELS.PREFERRED, MODELS.DEFAULT, MODELS.FALLBACK]);
    expect(result.response).toContain("mini answer");
  });

  it("surfaces a non-quota DEFAULT error after downgrade (base→mini stays quota-gated)", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("preferred boom"))
      .mockRejectedValueOnce(new Error("hard parse error in prompt"));
    await expect(executeCodexCLI({ prompt: "review", preferred: true })).rejects.toThrow("hard parse error in prompt");
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });

  it("preferred:false leaves behavior unchanged (single DEFAULT call)", async () => {
    mockExecuteCommand.mockResolvedValueOnce(AGENT("x"));
    await executeCodexCLI({ prompt: "review", preferred: false });
    expect(mockExecuteCommand).toHaveBeenCalledOnce();
    expect(modelOf(0)).toBe(MODELS.DEFAULT);
  });

  it("explicit model wins over preferred (no pro attempt)", async () => {
    mockExecuteCommand.mockResolvedValueOnce(AGENT("x"));
    await executeCodexCLI({ prompt: "review", preferred: true, model: "o3" });
    expect(mockExecuteCommand).toHaveBeenCalledOnce();
    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).toContain("o3");
    expect(args).not.toContain(MODELS.PREFERRED);
  });

  it("skips the preferred attempt when preferred:true but a sessionId is present", async () => {
    mockExecuteCommand.mockResolvedValueOnce(AGENT("resumed"));
    await executeCodexCLI({ prompt: "review", preferred: true, sessionId: "thread-1" });
    expect(mockExecuteCommand).toHaveBeenCalledOnce();
    expect(modelOf(0)).toBe(MODELS.DEFAULT);
  });

  it("does not populate the DEFAULT-keyed cache on a preferred success (cross-tier cache guard)", async () => {
    mockExecuteCommand.mockResolvedValue(AGENT("pro answer"));
    // A preferred success must NOT write the DEFAULT-keyed response cache, or a
    // later plain (base-model) call for the same prompt would be served a pro
    // answer under the base key. Proof: the follow-up preferred:false call is a
    // cache MISS and re-invokes codex → two calls total, not one.
    await executeCodexCLI({ prompt: "same review prompt", preferred: true });
    await executeCodexCLI({ prompt: "same review prompt", preferred: false });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });

  it("does not let a cached DEFAULT answer short-circuit a preferred:true call", async () => {
    mockExecuteCommand.mockResolvedValue(AGENT("cached base answer"));
    // Prime the DEFAULT-keyed cache with a plain (non-preferred) call...
    await executeCodexCLI({ prompt: "same review prompt", preferred: false });
    // ...a subsequent preferred call must still ATTEMPT the configured preferred model rather than be
    // served the cached base-model answer (the cache is keyed on MODELS.DEFAULT).
    await executeCodexCLI({ prompt: "same review prompt", preferred: true });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
    expect(modelOf(1)).toBe(MODELS.PREFERRED);
  });
});
