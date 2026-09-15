import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANTIGRAVITY, CLI, ERROR_MESSAGES, MODELS, OUTPUT_FORMATS, READ_ONLY_PREAMBLE } from "../../constants.js";

vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return {
    ...actual,
    executeCommand: vi.fn(),
    Logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
});

// Keep the real isVersionAtLeast — only the probe is mocked.
vi.mock("../agyVersion.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agyVersion.js")>();
  return {
    ...actual,
    assertSupportedAgyVersion: vi.fn(),
  };
});

import { executeCommand, Logger } from "@ask-llm/shared";
import { assertSupportedAgyVersion } from "../agyVersion.js";
import {
  buildArgs,
  executeAntigravityCLI,
  isModelUnavailableError,
  isPrintTimeoutTruncation,
  isTruncatedAnswerError,
  resolveExplicitEffort,
} from "../antigravityExecutor.js";

const mockExec = vi.mocked(executeCommand);
const mockAssertSupportedAgyVersion = vi.mocked(assertSupportedAgyVersion);

// Live-captured agy --output-format json success envelope (2026-08-04 dogfood, #251).
const jsonStdout = (response: string, usage?: Record<string, number>, extra?: Record<string, unknown>) =>
  JSON.stringify({
    conversation_id: "conversation-1",
    status: "SUCCESS",
    response,
    duration_seconds: 5.037288,
    num_turns: 1,
    ...(usage ? { usage } : {}),
    ...extra,
  });

// agy 1.1.28 prints a truncation note on stderr and still exits 0. Wording is
// changelog-shaped (not live-captured); matching is substring-based.
const PRINT_TIMEOUT_TRUNCATION_STDERR = "warning: the response may be truncated because --print-timeout expired\n";

function mockSuccessWithStderr(stdout: string, stderr: string): void {
  mockExec.mockImplementation(async (_command, _args, _onProgress, onStderr) => {
    if (stderr) onStderr?.(stderr);
    return stdout;
  });
}
const USAGE_1_1_9 = {
  input_tokens: 19832,
  output_tokens: 287,
  thinking_tokens: 281,
  cache_read_tokens: 12164,
  total_tokens: 20119,
};
// agy 1.1.5 reports usage without cache_read_tokens.
const USAGE_1_1_5 = { input_tokens: 10987, output_tokens: 297, thinking_tokens: 293, total_tokens: 11284 };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env[ANTIGRAVITY.SANDBOX_ENV_VAR];
  delete process.env[ANTIGRAVITY.TIMEOUT_ENV_VAR];
  delete process.env[ANTIGRAVITY.MODEL_ENV_VAR];
  delete process.env[ANTIGRAVITY.EFFORT_ENV_VAR];
  mockAssertSupportedAgyVersion.mockResolvedValue(ANTIGRAVITY.MINIMUM_AGY_VERSION);
  mockExec.mockResolvedValue("");
});

afterEach(() => {
  delete process.env[ANTIGRAVITY.SANDBOX_ENV_VAR];
  delete process.env[ANTIGRAVITY.TIMEOUT_ENV_VAR];
  delete process.env[ANTIGRAVITY.MODEL_ENV_VAR];
  delete process.env[ANTIGRAVITY.EFFORT_ENV_VAR];
});

describe("buildArgs", () => {
  it("builds -p, prompt, model, print-timeout, output-format json, skip-permissions, sandbox", () => {
    const args = buildArgs("hello", undefined, 295, true, "Gemini 3.5 Flash (High)");
    expect(args).toEqual([
      CLI.FLAGS.PRINT,
      "hello",
      CLI.FLAGS.MODEL,
      "Gemini 3.5 Flash (High)",
      CLI.FLAGS.PRINT_TIMEOUT,
      "295s",
      CLI.FLAGS.OUTPUT_FORMAT,
      OUTPUT_FORMATS.JSON,
      CLI.FLAGS.SKIP_PERMISSIONS,
      CLI.FLAGS.SANDBOX,
    ]);
  });

  it("omits sandbox when disabled, repeats --add-dir per includeDir, and places --model after dirs", () => {
    const args = buildArgs("hello", ["/a", "/b"], 100, false, "Gemini 3.5 Flash (High)");
    expect(args).toEqual([
      CLI.FLAGS.PRINT,
      "hello",
      CLI.FLAGS.ADD_DIR,
      "/a",
      CLI.FLAGS.ADD_DIR,
      "/b",
      CLI.FLAGS.MODEL,
      "Gemini 3.5 Flash (High)",
      CLI.FLAGS.PRINT_TIMEOUT,
      "100s",
      CLI.FLAGS.OUTPUT_FORMAT,
      OUTPUT_FORMATS.JSON,
      CLI.FLAGS.SKIP_PERMISSIONS,
    ]);
  });

  it("omits --model when no model is given", () => {
    const args = buildArgs("hello", undefined, 100, false, undefined);
    expect(args).not.toContain(CLI.FLAGS.MODEL);
  });

  it("appends --disable-slash-commands only when requested", () => {
    const guarded = buildArgs("hello", undefined, 100, false, undefined, false, undefined, true);
    expect(guarded).toContain(CLI.FLAGS.DISABLE_SLASH_COMMANDS);
    const unguarded = buildArgs("hello", undefined, 100, false, undefined);
    expect(unguarded).not.toContain(CLI.FLAGS.DISABLE_SLASH_COMMANDS);
  });
});

describe("executeAntigravityCLI response sources", () => {
  it("requests --output-format json on every invocation", async () => {
    mockExec.mockResolvedValue(jsonStdout("pong\n"));
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    expect(args[args.indexOf(CLI.FLAGS.OUTPUT_FORMAT) + 1]).toBe(OUTPUT_FORMATS.JSON);
  });

  it("uses the JSON envelope's .response and trims agy's trailing newline", async () => {
    mockExec.mockResolvedValue(jsonStdout("pong\n"));
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("pong");
  });

  it("falls back to plain stdout when output is not the JSON envelope", async () => {
    mockExec.mockResolvedValue("direct answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("direct answer");
    expect(result.usage).toBeUndefined();
  });

  it("never serves a parsed envelope with an empty response as plain text", async () => {
    mockExec.mockResolvedValue(jsonStdout(""));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.NO_OUTPUT);
  });

  it("never serves a parsed envelope without a response key as plain text", async () => {
    mockExec.mockResolvedValue('{"conversation_id":"conversation-1","status":"SUCCESS"}');
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.NO_OUTPUT);
  });

  it("fails closed on JSON-looking but unparsable stdout (corrupt envelope)", async () => {
    mockExec.mockResolvedValue('{"conversation_id":"conversation-1","status":"SUCCESS","response":"pon');
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.NO_OUTPUT);
  });

  it("fails closed on a parsed array instead of serving it as plain stdout", async () => {
    mockExec.mockResolvedValue('["fragment"]');
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.NO_OUTPUT);
  });

  it("fails closed on array-looking but unparsable stdout", async () => {
    mockExec.mockResolvedValue('["fragment"');
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.NO_OUTPUT);
  });

  it("throws the actionable NO_OUTPUT when stdout is empty", async () => {
    mockExec.mockResolvedValue("");
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.NO_OUTPUT);
  });

  it("returns no sessionId", async () => {
    mockExec.mockResolvedValue(jsonStdout("answer\n"));
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.sessionId).toBeUndefined();
  });
});

describe("executeAntigravityCLI usage accounting", () => {
  it("maps the agy >=1.1.7 usage object including cache_read_tokens", async () => {
    mockExec.mockResolvedValue(jsonStdout("pong\n", USAGE_1_1_9));
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.usage).toMatchObject({
      provider: "antigravity",
      model: MODELS.DEFAULT,
      inputTokens: 19832,
      outputTokens: 287,
      cachedTokens: 12164,
      thinkingTokens: 281,
      fellBack: false,
    });
  });

  it("omits cachedTokens for the agy 1.1.5 usage shape (no cache_read_tokens)", async () => {
    mockExec.mockResolvedValue(jsonStdout("pong\n", USAGE_1_1_5));
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.usage?.cachedTokens).toBeUndefined();
    expect(result.usage?.inputTokens).toBe(10987);
  });

  it("returns usage undefined when the envelope carries no usage object", async () => {
    mockExec.mockResolvedValue(jsonStdout("pong\n"));
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.usage).toBeUndefined();
  });

  it("measures durationMs itself instead of trusting agy's duration_seconds", async () => {
    // The fixture claims ~5s; a resumed conversation even reports its age (~497s).
    mockExec.mockResolvedValue(jsonStdout("pong\n", USAGE_1_1_9));
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.usage?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.usage?.durationMs).toBeLessThan(60_000);
  });

  it("marks fellBack on the rate-limit Flash fallback and reports the fallback model", async () => {
    mockExec
      .mockRejectedValueOnce(new Error("RESOURCE_EXHAUSTED: quota"))
      .mockResolvedValueOnce(jsonStdout("flash answer\n", USAGE_1_1_9));
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.model).toBe(MODELS.FALLBACK);
    expect(result.usage?.model).toBe(MODELS.FALLBACK);
    expect(result.usage?.fellBack).toBe(true);
  });
});

describe("executeAntigravityCLI slash-command hardening", () => {
  it("passes --disable-slash-commands when agy is at least 1.1.9", async () => {
    mockAssertSupportedAgyVersion.mockResolvedValue(ANTIGRAVITY.SLASH_COMMANDS_FLAG_MIN_VERSION);
    mockExec.mockResolvedValue(jsonStdout("answer\n"));
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    expect(args).toContain(CLI.FLAGS.DISABLE_SLASH_COMMANDS);
  });

  it("passes the flag on newer versions too", async () => {
    mockAssertSupportedAgyVersion.mockResolvedValue("1.1.10");
    mockExec.mockResolvedValue(jsonStdout("answer\n"));
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    expect(args).toContain(CLI.FLAGS.DISABLE_SLASH_COMMANDS);
  });

  it("omits the flag at the 1.1.5 minimum (hard 'flags provided but not defined' error below 1.1.9)", async () => {
    mockExec.mockResolvedValue(jsonStdout("answer\n"));
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    expect(args).not.toContain(CLI.FLAGS.DISABLE_SLASH_COMMANDS);
  });
});

describe("minimum version pin", () => {
  // --output-format json is live-proven on 1.1.5/1.1.7/1.1.8/1.1.9 (#251 dogfood);
  // structured output needs no version gate, so do not bump without new evidence.
  it("keeps MINIMUM_AGY_VERSION at the evidence-backed 1.1.5", () => {
    expect(ANTIGRAVITY.MINIMUM_AGY_VERSION).toBe("1.1.5");
  });

  it("gates the exit-0 print-timeout truncation contract at agy 1.1.28", () => {
    expect(ANTIGRAVITY.PRINT_TIMEOUT_SUCCESS_TRUNCATION_MIN_VERSION).toBe("1.1.28");
  });
});

describe("executeAntigravityCLI argument wiring", () => {
  it("does not forward structured stdout chunks as progress", async () => {
    const onProgress = vi.fn();
    mockExec.mockResolvedValue(jsonStdout("answer\n"));
    await executeAntigravityCLI({ prompt: "q", onProgress });
    expect(mockExec.mock.calls[0][2]).toBeUndefined();
  });

  it("captures stderr on the success path so agy 1.1.28 truncation notes are reachable", async () => {
    mockExec.mockResolvedValue(jsonStdout("answer\n"));
    await executeAntigravityCLI({ prompt: "q" });
    expect(typeof mockExec.mock.calls[0][3]).toBe("function");
  });

  it("keeps agy --print-timeout 5s below the process timeout so agy expires first", async () => {
    mockExec.mockResolvedValue(jsonStdout("answer\n"));
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    expect(args[args.indexOf(CLI.FLAGS.PRINT_TIMEOUT) + 1]).toBe("295s");
    expect(mockExec.mock.calls[0][5]).toBe(ANTIGRAVITY.DEFAULT_TIMEOUT_MS);
  });

  it("forwards caller cancellation through version probing and execution", async () => {
    const signal = new AbortController().signal;
    mockExec.mockResolvedValue(jsonStdout("answer\n"));
    await executeAntigravityCLI({ prompt: "q", signal });
    expect(mockAssertSupportedAgyVersion).toHaveBeenCalledWith(signal);
    expect(mockExec.mock.calls[0][7]).toBe(signal);
  });

  it("marks the exact full read-only prompt as sensitive command-log data", async () => {
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "private machine review", readOnly: true });

    const [, args, , , , , commandLogging] = mockExec.mock.calls[0];
    const fullPrompt = args[1];
    expect(fullPrompt).toContain(READ_ONLY_PREAMBLE);
    expect(fullPrompt).toContain("private machine review");
    expect(commandLogging).toEqual({ sensitiveValues: [fullPrompt] });
  });

  it("prepends the read-only preamble to the prompt", async () => {
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "review this" });
    const [, args] = mockExec.mock.calls[0];
    expect(args[0]).toBe(CLI.FLAGS.PRINT);
    expect(args[1]).toContain(READ_ONLY_PREAMBLE);
    expect(args[1]).toContain("review this");
  });

  it("passes includeDirs through as --add-dir", async () => {
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "q", includeDirs: ["/pkg/a"] });
    const [, args] = mockExec.mock.calls[0];
    expect(args).toContain(CLI.FLAGS.ADD_DIR);
    expect(args).toContain("/pkg/a");
  });

  it("drops --sandbox when ASK_ANTIGRAVITY_SANDBOX=0", async () => {
    process.env[ANTIGRAVITY.SANDBOX_ENV_VAR] = "0";
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    expect(args).not.toContain(CLI.FLAGS.SANDBOX);
  });

  it("does not invert agy --print-timeout for very small configured timeouts", async () => {
    process.env[ANTIGRAVITY.TIMEOUT_ENV_VAR] = "3000";
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    const idx = args.indexOf(CLI.FLAGS.PRINT_TIMEOUT);
    expect(args[idx + 1]).toBe("3s");
  });
});

describe("executeAntigravityCLI model selection", () => {
  it("passes the default model via --model and reports it when none is specified", async () => {
    mockExec.mockResolvedValue("answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    const idx = args.indexOf(CLI.FLAGS.MODEL);
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe(MODELS.DEFAULT);
    expect(result.model).toBe(MODELS.DEFAULT);
  });

  it("honors ASK_ANTIGRAVITY_MODEL over the default", async () => {
    process.env[ANTIGRAVITY.MODEL_ENV_VAR] = "Gemini 3.5 Flash (Low)";
    mockExec.mockResolvedValue("answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    const idx = args.indexOf(CLI.FLAGS.MODEL);
    expect(args[idx + 1]).toBe("Gemini 3.5 Flash (Low)");
    expect(result.model).toBe("Gemini 3.5 Flash (Low)");
  });

  it("lets an explicit options.model win over env and default", async () => {
    process.env[ANTIGRAVITY.MODEL_ENV_VAR] = "Gemini 3.1 Pro (High)";
    mockExec.mockResolvedValue("answer");
    const result = await executeAntigravityCLI({ prompt: "q", model: "Claude Sonnet 4.6 (Thinking)" });
    const [, args] = mockExec.mock.calls[0];
    const idx = args.indexOf(CLI.FLAGS.MODEL);
    expect(args[idx + 1]).toBe("Claude Sonnet 4.6 (Thinking)");
    expect(result.model).toBe("Claude Sonnet 4.6 (Thinking)");
  });
});

describe("executeAntigravityCLI error handling", () => {
  it("rejects an unsupported agy version before invoking a model", async () => {
    mockAssertSupportedAgyVersion.mockRejectedValue(
      new Error(
        `Antigravity CLI (agy) 1.1.4 is unsupported. @ask-llm/antigravity-mcp requires agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION}.`,
      ),
    );

    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(
      `requires agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION}`,
    );
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("rethrows non-rate-limit errors unchanged without attempting a fallback", async () => {
    mockExec.mockRejectedValue(new Error("agy CLI not found on PATH"));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow("agy CLI not found on PATH");
    expect(mockExec).toHaveBeenCalledOnce();
  });
});

describe("executeAntigravityCLI rate-limit fallback", () => {
  // Keep agy's fallback on its live-catalog-proven slug until fresh `agy models` evidence exists.
  it("keeps the evidence-based agy fallback slug on gemini-3.5-flash", () => {
    expect(MODELS.FALLBACK).toBe("gemini-3.5-flash");
    expect(MODELS.DEFAULT).toBe("gemini-3.1-pro");
  });

  it("redacts the read-only prompt on both primary and fallback command logs", async () => {
    mockExec.mockRejectedValueOnce(new Error("RESOURCE_EXHAUSTED: quota")).mockResolvedValueOnce("flash answer");

    await executeAntigravityCLI({ prompt: "private fallback review", readOnly: true });

    expect(mockExec).toHaveBeenCalledTimes(2);
    for (const call of mockExec.mock.calls) {
      const fullPrompt = call[1][1];
      expect(call[6]).toEqual({ sensitiveValues: [fullPrompt] });
      expect(fullPrompt).toContain("private fallback review");
    }
  });

  it("retries on the Flash fallback when the default Pro model is rate limited", async () => {
    mockExec.mockRejectedValueOnce(new Error("RESOURCE_EXHAUSTED: quota")).mockResolvedValueOnce("flash answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("flash answer");
    expect(result.model).toBe(MODELS.FALLBACK);
    // first attempt used the default model, the retry used the fallback model
    const firstArgs = mockExec.mock.calls[0][1];
    const secondArgs = mockExec.mock.calls[1][1];
    expect(firstArgs[firstArgs.indexOf(CLI.FLAGS.MODEL) + 1]).toBe(MODELS.DEFAULT);
    expect(secondArgs[secondArgs.indexOf(CLI.FLAGS.MODEL) + 1]).toBe(MODELS.FALLBACK);
  });

  it("does not retry when the resolved model already is the fallback", async () => {
    process.env[ANTIGRAVITY.MODEL_ENV_VAR] = MODELS.FALLBACK;
    mockExec.mockRejectedValue(new Error("rate limit"));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.RATE_LIMITED);
    expect(mockExec).toHaveBeenCalledOnce();
  });

  it("throws the actionable RATE_LIMITED message when both tiers are throttled", async () => {
    mockExec.mockRejectedValue(new Error("429 too many requests"));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.RATE_LIMITED);
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("surfaces a non-rate-limit fallback failure instead of masking it as RATE_LIMITED", async () => {
    mockExec
      .mockRejectedValueOnce(new Error("RESOURCE_EXHAUSTED"))
      .mockRejectedValueOnce(new Error("agy crashed during fallback"));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow("agy crashed during fallback");
  });
});

// Live-captured agy 1.1.5 error grammar (issue #243 dogfood run, 2026-07-23).
const unknownModelError = (model: string) =>
  new Error(
    `Error: invalid model selection (--model "${model}" --effort "high"): model ${model} is not recognized as a known model or custom model in settings\n` +
      "Available models:\n  Gemini 3.6 Flash (High)",
  );
const effortSelectionError = new Error(
  'Error: invalid model selection (--model "gemini-3.1-pro" --effort "medium"): gemini-3.1-pro has no "medium" effort (available: low, high)',
);

describe("buildArgs effort", () => {
  it("emits --effort after --model when provided", () => {
    const args = buildArgs("hello", undefined, 100, false, MODELS.DEFAULT, false, "high");
    const modelIdx = args.indexOf(CLI.FLAGS.MODEL);
    expect(args[modelIdx + 1]).toBe(MODELS.DEFAULT);
    expect(args[modelIdx + 2]).toBe(CLI.FLAGS.EFFORT);
    expect(args[modelIdx + 3]).toBe("high");
  });

  it("omits --effort when not provided", () => {
    const args = buildArgs("hello", undefined, 100, false, MODELS.DEFAULT);
    expect(args).not.toContain(CLI.FLAGS.EFFORT);
  });

  it("emits --effort on a model-less invocation", () => {
    const args = buildArgs("hello", undefined, 100, false, undefined, false, "medium");
    expect(args).not.toContain(CLI.FLAGS.MODEL);
    expect(args.indexOf(CLI.FLAGS.EFFORT)).toBeGreaterThan(-1);
    expect(args[args.indexOf(CLI.FLAGS.EFFORT) + 1]).toBe("medium");
  });
});

describe("resolveExplicitEffort", () => {
  it("returns undefined when ASK_ANTIGRAVITY_EFFORT is unset", () => {
    expect(resolveExplicitEffort()).toBeUndefined();
  });

  it("returns the validated, lowercased value", () => {
    process.env[ANTIGRAVITY.EFFORT_ENV_VAR] = " MEDIUM ";
    expect(resolveExplicitEffort()).toBe("medium");
  });

  it("warns and returns undefined for an invalid value", () => {
    process.env[ANTIGRAVITY.EFFORT_ENV_VAR] = "turbo";
    expect(resolveExplicitEffort()).toBeUndefined();
    expect(vi.mocked(Logger.warn)).toHaveBeenCalledWith(expect.stringContaining(ANTIGRAVITY.EFFORT_ENV_VAR));
    expect(vi.mocked(Logger.warn)).toHaveBeenCalledWith(expect.stringContaining("turbo"));
  });
});

describe("executeAntigravityCLI effort selection", () => {
  it("pairs the default effort with the default base slug (the proven valid agy 1.1.5 path)", async () => {
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    expect(args[args.indexOf(CLI.FLAGS.MODEL) + 1]).toBe(MODELS.DEFAULT);
    expect(args[args.indexOf(CLI.FLAGS.EFFORT) + 1]).toBe(ANTIGRAVITY.DEFAULT_EFFORT);
  });

  it("honors ASK_ANTIGRAVITY_EFFORT over the default effort", async () => {
    process.env[ANTIGRAVITY.EFFORT_ENV_VAR] = "low";
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    expect(args[args.indexOf(CLI.FLAGS.EFFORT) + 1]).toBe("low");
  });

  it("falls back to the default effort when ASK_ANTIGRAVITY_EFFORT is invalid", async () => {
    process.env[ANTIGRAVITY.EFFORT_ENV_VAR] = "turbo";
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    expect(args[args.indexOf(CLI.FLAGS.EFFORT) + 1]).toBe(ANTIGRAVITY.DEFAULT_EFFORT);
  });

  it("suppresses --effort for a pinned effort-carrying model (agy would reject the pair)", async () => {
    process.env[ANTIGRAVITY.MODEL_ENV_VAR] = "Gemini 3.1 Pro (High)";
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    expect(args[args.indexOf(CLI.FLAGS.MODEL) + 1]).toBe("Gemini 3.1 Pro (High)");
    expect(args).not.toContain(CLI.FLAGS.EFFORT);
  });

  it("always emits an explicitly set ASK_ANTIGRAVITY_EFFORT, even with an effort-carrying pin", async () => {
    // The user owns this (invalid) combination — explicit effort must override the
    // suppression applied to effort-carrying names, not be silently dropped.
    process.env[ANTIGRAVITY.MODEL_ENV_VAR] = "Gemini 3.1 Pro (High)";
    process.env[ANTIGRAVITY.EFFORT_ENV_VAR] = "medium";
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    expect(args[args.indexOf(CLI.FLAGS.EFFORT) + 1]).toBe("medium");
  });
});

// Live-captured agy 1.1.9 json-mode error envelope (stdout, exit 1). It reaches
// the matchers because executeCommand unions stderr+stdout on non-zero exit (ADR-117).
const jsonWrappedUnknownModelError = new Error(
  '{"conversation_id":"","status":"ERROR","response":"","error":"invalid model selection (--model \\"gemini-3.1-pro\\" --effort \\"\\"): model gemini-3.1-pro is not recognized as a known model or custom model in settings\\nAvailable models:\\n  Gemini 3.6 Flash (High)","duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0}}',
);

describe("isModelUnavailableError", () => {
  it("matches the live agy 1.1.5 unknown-model and effort-selection errors", () => {
    expect(isModelUnavailableError(unknownModelError("gemini-3.1-pro").message)).toBe(true);
    expect(isModelUnavailableError(effortSelectionError.message)).toBe(true);
  });

  it("matches the json-mode error envelope carried on stdout", () => {
    expect(isModelUnavailableError(jsonWrappedUnknownModelError.message)).toBe(true);
  });

  it("does not match rate-limit or unrelated errors", () => {
    expect(isModelUnavailableError("RESOURCE_EXHAUSTED: quota")).toBe(false);
    expect(isModelUnavailableError("429 too many requests")).toBe(false);
    expect(isModelUnavailableError("agy CLI not found on PATH")).toBe(false);
    expect(isModelUnavailableError(ERROR_MESSAGES.NO_OUTPUT)).toBe(false);
  });

  it("does not match a truncated answer whose preview quotes invalid model selection", () => {
    expect(
      isModelUnavailableError(
        `${ERROR_MESSAGES.TRUNCATED} Partial output follows: invalid model selection --model "x"`,
      ),
    ).toBe(false);
  });
});

describe("executeAntigravityCLI model-unavailable recovery (#243)", () => {
  it("recovers from the json-mode error envelope exactly like the text-mode grammar", async () => {
    mockExec.mockRejectedValueOnce(jsonWrappedUnknownModelError).mockResolvedValueOnce(jsonStdout("rescued\n"));
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("rescued");
    expect(result.model).toBe(MODELS.AGY_DEFAULT_LABEL);
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("retries once model-less when agy rejects the default slug, keeping --effort", async () => {
    mockExec.mockRejectedValueOnce(unknownModelError(MODELS.DEFAULT)).mockResolvedValueOnce("rescued");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("rescued");
    expect(result.model).toBe(MODELS.AGY_DEFAULT_LABEL);
    expect(mockExec).toHaveBeenCalledTimes(2);
    const retryArgs = mockExec.mock.calls[1][1];
    expect(retryArgs).not.toContain(CLI.FLAGS.MODEL);
    expect(retryArgs[retryArgs.indexOf(CLI.FLAGS.EFFORT) + 1]).toBe(ANTIGRAVITY.DEFAULT_EFFORT);
  });

  it("recovers model-less from an effort-selection rejection, preserving the requested effort", async () => {
    process.env[ANTIGRAVITY.EFFORT_ENV_VAR] = "medium";
    mockExec.mockRejectedValueOnce(effortSelectionError).mockResolvedValueOnce("rescued");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("rescued");
    const retryArgs = mockExec.mock.calls[1][1];
    expect(retryArgs).not.toContain(CLI.FLAGS.MODEL);
    expect(retryArgs[retryArgs.indexOf(CLI.FLAGS.EFFORT) + 1]).toBe("medium");
  });

  it("retries model-less for an options.model pin equal to the shipped default (value gate, not provenance)", async () => {
    mockExec.mockRejectedValueOnce(unknownModelError(MODELS.DEFAULT)).mockResolvedValueOnce("rescued");
    const result = await executeAntigravityCLI({ prompt: "q", model: MODELS.DEFAULT });
    expect(result.response).toBe("rescued");
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("retries model-less for an ASK_ANTIGRAVITY_MODEL pin equal to the shipped default", async () => {
    process.env[ANTIGRAVITY.MODEL_ENV_VAR] = MODELS.DEFAULT;
    mockExec.mockRejectedValueOnce(unknownModelError(MODELS.DEFAULT)).mockResolvedValueOnce("rescued");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("rescued");
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("never retries a second time: a rejected model-less retry maps to the actionable error", async () => {
    mockExec.mockRejectedValue(unknownModelError(MODELS.DEFAULT));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(
      new RegExp(`rejected model "${MODELS.DEFAULT}".*agy models`),
    );
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("maps a rate limit on the model-less retry to the actionable RATE_LIMITED message", async () => {
    mockExec.mockRejectedValueOnce(unknownModelError(MODELS.DEFAULT)).mockRejectedValueOnce(new Error("429"));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.RATE_LIMITED);
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("surfaces an unrelated model-less retry failure as-is", async () => {
    mockExec.mockRejectedValueOnce(unknownModelError(MODELS.DEFAULT)).mockRejectedValueOnce(new Error("agy crashed"));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow("agy crashed");
  });

  it("points the remediation at ASK_ANTIGRAVITY_EFFORT when an explicit effort caused the rejection", async () => {
    process.env[ANTIGRAVITY.EFFORT_ENV_VAR] = "medium";
    mockExec.mockRejectedValue(effortSelectionError);
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(
      new RegExp(`${ANTIGRAVITY.EFFORT_ENV_VAR}="medium"`),
    );
    // default model → still gets the one-time model-less retry before failing
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("points a rejected pin's remediation at the explicit effort when one is set", async () => {
    process.env[ANTIGRAVITY.MODEL_ENV_VAR] = "Gemini 3.1 Pro (High)";
    process.env[ANTIGRAVITY.EFFORT_ENV_VAR] = "low";
    mockExec.mockRejectedValue(
      new Error(
        'Error: invalid model selection (--model "Gemini 3.1 Pro (High)" --effort "low"): --effort is not supported for model "Gemini 3.1 Pro (High)"',
      ),
    );
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(
      new RegExp(`${ANTIGRAVITY.EFFORT_ENV_VAR}="low"`),
    );
    expect(mockExec).toHaveBeenCalledOnce();
  });

  it("fails actionably without any retry when a user-pinned model is rejected", async () => {
    process.env[ANTIGRAVITY.MODEL_ENV_VAR] = "Gemini 9 Ultra";
    mockExec.mockRejectedValue(unknownModelError("Gemini 9 Ultra"));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(
      /rejected model "Gemini 9 Ultra".*agy models.*ASK_ANTIGRAVITY_MODEL/s,
    );
    expect(mockExec).toHaveBeenCalledOnce();
  });

  it("tailors the remediation when the rejected pin came from options.model", async () => {
    mockExec.mockRejectedValue(unknownModelError("bogus-model"));
    await expect(executeAntigravityCLI({ prompt: "q", model: "bogus-model" })).rejects.toThrow(
      /rejected model "bogus-model".*Pass a valid model/s,
    );
    expect(mockExec).toHaveBeenCalledOnce();
  });

  it("recovers model-less when the rate-limit fallback slug is itself rejected", async () => {
    mockExec
      .mockRejectedValueOnce(new Error("RESOURCE_EXHAUSTED: quota"))
      .mockRejectedValueOnce(unknownModelError(MODELS.FALLBACK))
      .mockResolvedValueOnce("rescued");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("rescued");
    expect(result.model).toBe(MODELS.AGY_DEFAULT_LABEL);
    expect(mockExec).toHaveBeenCalledTimes(3);
    expect(mockExec.mock.calls[2][1]).not.toContain(CLI.FLAGS.MODEL);
  });

  it("does not conflate a model-unavailable rejection with the Flash rate-limit fallback", async () => {
    mockExec.mockRejectedValueOnce(unknownModelError(MODELS.DEFAULT)).mockResolvedValueOnce("rescued");
    await executeAntigravityCLI({ prompt: "q" });
    // the retry is model-less — it never re-pins MODELS.FALLBACK
    const retryArgs = mockExec.mock.calls[1][1];
    expect(retryArgs).not.toContain(MODELS.FALLBACK);
  });
});

describe("isPrintTimeoutTruncation", () => {
  it("matches changelog-shaped truncation notes and status tokens", () => {
    expect(isPrintTimeoutTruncation(PRINT_TIMEOUT_TRUNCATION_STDERR)).toBe(true);
    expect(isPrintTimeoutTruncation("timeout expired")).toBe(true);
    expect(isPrintTimeoutTruncation("partial output may be truncated")).toBe(true);
  });

  it("does not match quota or model-selection errors", () => {
    expect(isPrintTimeoutTruncation("RESOURCE_EXHAUSTED: quota")).toBe(false);
    expect(isPrintTimeoutTruncation(unknownModelError(MODELS.DEFAULT).message)).toBe(false);
    expect(isPrintTimeoutTruncation(ERROR_MESSAGES.NO_OUTPUT)).toBe(false);
  });
});

describe("isTruncatedAnswerError", () => {
  it("matches the truncation prefix even when the partial names recovery tokens", () => {
    expect(
      isTruncatedAnswerError(
        `${ERROR_MESSAGES.TRUNCATED} Increase ASK_ANTIGRAVITY_TIMEOUT_MS. Partial output follows: quota rate limit invalid model selection`,
      ),
    ).toBe(true);
  });

  it("does not match a raw quota or model-selection error", () => {
    expect(isTruncatedAnswerError("RESOURCE_EXHAUSTED: quota")).toBe(false);
    expect(isTruncatedAnswerError(unknownModelError(MODELS.DEFAULT).message)).toBe(false);
  });
});

describe("executeAntigravityCLI print-timeout truncation (agy >= 1.1.28)", () => {
  it("fails closed when stderr says the exit-0 JSON answer may be truncated", async () => {
    mockAssertSupportedAgyVersion.mockResolvedValue(ANTIGRAVITY.PRINT_TIMEOUT_SUCCESS_TRUNCATION_MIN_VERSION);
    mockSuccessWithStderr(jsonStdout("partial second opinion\n"), PRINT_TIMEOUT_TRUNCATION_STDERR);

    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.TRUNCATED);
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(/partial second opinion/);
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ANTIGRAVITY.TIMEOUT_ENV_VAR);
  });

  it("fails closed when the JSON envelope sets truncated:true even without stderr", async () => {
    mockAssertSupportedAgyVersion.mockResolvedValue("1.2.2");
    mockExec.mockResolvedValue(jsonStdout("cut off mid sentence", undefined, { truncated: true }));

    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.TRUNCATED);
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(/cut off mid sentence/);
  });

  it("fails closed on truncated plain stdout, not as a complete answer", async () => {
    mockAssertSupportedAgyVersion.mockResolvedValue(ANTIGRAVITY.PRINT_TIMEOUT_SUCCESS_TRUNCATION_MIN_VERSION);
    mockSuccessWithStderr("plain partial", PRINT_TIMEOUT_TRUNCATION_STDERR);

    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.TRUNCATED);
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(/plain partial/);
  });

  it("uses the truncated error rather than NO_OUTPUT when the envelope is empty", async () => {
    mockAssertSupportedAgyVersion.mockResolvedValue(ANTIGRAVITY.PRINT_TIMEOUT_SUCCESS_TRUNCATION_MIN_VERSION);
    mockSuccessWithStderr(jsonStdout(""), PRINT_TIMEOUT_TRUNCATION_STDERR);

    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.TRUNCATED);
  });

  it("does not treat truncation as a rate-limit and does not retry Flash", async () => {
    mockAssertSupportedAgyVersion.mockResolvedValue(ANTIGRAVITY.PRINT_TIMEOUT_SUCCESS_TRUNCATION_MIN_VERSION);
    mockSuccessWithStderr(jsonStdout("partial\n"), PRINT_TIMEOUT_TRUNCATION_STDERR);

    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.TRUNCATED);
    expect(mockExec).toHaveBeenCalledOnce();
  });

  it("does not retry Flash or drop the model when the truncated preview names recovery tokens", async () => {
    mockAssertSupportedAgyVersion.mockResolvedValue(ANTIGRAVITY.PRINT_TIMEOUT_SUCCESS_TRUNCATION_MIN_VERSION);
    mockSuccessWithStderr(
      jsonStdout("code review: quota / rate limit / invalid model selection in the snippet\n"),
      PRINT_TIMEOUT_TRUNCATION_STDERR,
    );

    const error = await executeAntigravityCLI({ prompt: "q" }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(ERROR_MESSAGES.TRUNCATED);
    expect((error as Error).message).toMatch(/quota \/ rate limit \/ invalid model selection/);
    expect(mockExec).toHaveBeenCalledOnce();
  });

  it("still serves a complete exit-0 answer when there is no truncation signal", async () => {
    mockAssertSupportedAgyVersion.mockResolvedValue(ANTIGRAVITY.PRINT_TIMEOUT_SUCCESS_TRUNCATION_MIN_VERSION);
    mockSuccessWithStderr(jsonStdout("complete answer\n"), "some unrelated warning\n");

    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("complete answer");
  });

  it("ignores truncation-shaped stderr below 1.1.28, where timeout still exits non-zero", async () => {
    mockAssertSupportedAgyVersion.mockResolvedValue("1.1.27");
    mockSuccessWithStderr(jsonStdout("complete-looking\n"), PRINT_TIMEOUT_TRUNCATION_STDERR);

    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("complete-looking");
  });

  it("appends denied_actions from a complete envelope so thin answers are explained", async () => {
    mockAssertSupportedAgyVersion.mockResolvedValue("1.1.27");
    mockExec.mockResolvedValue(jsonStdout("thin answer\n", undefined, { denied_actions: ["fetch_url"] }));

    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toContain("thin answer");
    expect(result.response).toMatch(/denied 1 action\(s\): fetch_url/);
  });
});
