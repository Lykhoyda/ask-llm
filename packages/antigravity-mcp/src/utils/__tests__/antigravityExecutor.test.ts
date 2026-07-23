import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANTIGRAVITY, CLI, ERROR_MESSAGES, MODELS, READ_ONLY_PREAMBLE } from "../../constants.js";

vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return {
    ...actual,
    executeCommand: vi.fn(),
    Logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
});

vi.mock("../transcriptReader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../transcriptReader.js")>();
  return {
    ...actual,
    readLatestTranscript: vi.fn(),
    snapshotTranscriptState: vi.fn(),
  };
});

import { executeCommand, Logger } from "@ask-llm/shared";
import {
  buildArgs,
  executeAntigravityCLI,
  isModelUnavailableError,
  resolveExplicitEffort,
} from "../antigravityExecutor.js";
import { antigravityInvocationLockPath } from "../invocationLock.js";
import { readLatestTranscript, snapshotTranscriptState } from "../transcriptReader.js";

const mockExec = vi.mocked(executeCommand);
const mockReadLatestTranscript = vi.mocked(readLatestTranscript);
const mockSnapshotTranscriptState = vi.mocked(snapshotTranscriptState);
let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "agy-executor-test-"));
  vi.clearAllMocks();
  delete process.env[ANTIGRAVITY.SANDBOX_ENV_VAR];
  delete process.env[ANTIGRAVITY.TIMEOUT_ENV_VAR];
  delete process.env[ANTIGRAVITY.MODEL_ENV_VAR];
  delete process.env[ANTIGRAVITY.EFFORT_ENV_VAR];
  process.env.ASK_ANTIGRAVITY_BASE_DIR = baseDir;
  mockExec.mockResolvedValue("");
  mockReadLatestTranscript.mockReturnValue(null);
  mockSnapshotTranscriptState.mockReturnValue({ baseDir, transcripts: {} });
});

afterEach(() => {
  delete process.env.ASK_ANTIGRAVITY_BASE_DIR;
  rmSync(baseDir, { recursive: true, force: true });
});

describe("buildArgs", () => {
  it("builds -p, prompt, model, print-timeout, skip-permissions, sandbox", () => {
    const args = buildArgs("hello", undefined, 295, true, "Gemini 3.5 Flash (High)");
    expect(args).toEqual([
      CLI.FLAGS.PRINT,
      "hello",
      CLI.FLAGS.MODEL,
      "Gemini 3.5 Flash (High)",
      CLI.FLAGS.PRINT_TIMEOUT,
      "295s",
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
      CLI.FLAGS.SKIP_PERMISSIONS,
    ]);
  });

  it("omits --model when no model is given", () => {
    const args = buildArgs("hello", undefined, 100, false, undefined);
    expect(args).not.toContain(CLI.FLAGS.MODEL);
  });
});

describe("executeAntigravityCLI response sources", () => {
  it("uses plain stdout only as a last resort, after the transcript", async () => {
    mockExec.mockResolvedValue("direct answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("direct answer");
    // transcript is consulted before plain stdout
    expect(mockReadLatestTranscript).toHaveBeenCalledOnce();
  });

  it("prefers the transcript over non-JSON stdout banners (#153)", async () => {
    mockExec.mockResolvedValue("Initializing model...");
    mockReadLatestTranscript.mockReturnValue({
      response: "real answer",
      path: "/agy/transcript.jsonl",
      conversationId: "conversation-1",
    });
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("real answer");
  });

  it("uses JSON stdout .response when present", async () => {
    mockExec.mockResolvedValue('{"response":"json answer"}');
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("json answer");
    expect(mockReadLatestTranscript).not.toHaveBeenCalled();
  });

  it("falls back to transcript scrape when stdout is empty (today's bug)", async () => {
    mockExec.mockResolvedValue("");
    mockReadLatestTranscript.mockReturnValue({
      response: "scraped answer",
      path: "/agy/transcript.jsonl",
      conversationId: "conversation-1",
    });
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("scraped answer");
    expect(mockReadLatestTranscript).toHaveBeenCalledOnce();
    expect(typeof mockReadLatestTranscript.mock.calls[0][0]).toBe("number");
    expect(mockReadLatestTranscript.mock.calls[0][1]).toEqual({ baseDir, transcripts: {} });
  });

  it("returns the durable transcript path when the response comes from the transcript", async () => {
    mockExec.mockResolvedValue("");
    mockReadLatestTranscript.mockReturnValue({
      response: "scraped answer",
      path: "/agy/brain/conversation-1/.system_generated/logs/transcript_full.jsonl",
      conversationId: "conversation-1",
    });

    const result = await executeAntigravityCLI({ prompt: "q", readOnly: true });

    expect(result.response).toBe("scraped answer");
    expect(result.transcriptPath).toBe("/agy/brain/conversation-1/.system_generated/logs/transcript_full.jsonl");
  });

  it("throws NO_OUTPUT when stdout is empty and no transcript is found", async () => {
    mockExec.mockResolvedValue("");
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.NO_OUTPUT);
  });

  it("returns no sessionId and no usage", async () => {
    mockExec.mockResolvedValue("answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.sessionId).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });
});

describe("executeAntigravityCLI argument wiring", () => {
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
  it("rethrows non-rate-limit errors unchanged without attempting a fallback", async () => {
    mockExec.mockRejectedValue(new Error("agy CLI not found on PATH"));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow("agy CLI not found on PATH");
    expect(mockExec).toHaveBeenCalledOnce();
  });
});

describe("executeAntigravityCLI rate-limit fallback", () => {
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

describe("isModelUnavailableError", () => {
  it("matches the live agy 1.1.5 unknown-model and effort-selection errors", () => {
    expect(isModelUnavailableError(unknownModelError("gemini-3.1-pro").message)).toBe(true);
    expect(isModelUnavailableError(effortSelectionError.message)).toBe(true);
  });

  it("does not match rate-limit or unrelated errors", () => {
    expect(isModelUnavailableError("RESOURCE_EXHAUSTED: quota")).toBe(false);
    expect(isModelUnavailableError("429 too many requests")).toBe(false);
    expect(isModelUnavailableError("agy CLI not found on PATH")).toBe(false);
    expect(isModelUnavailableError(ERROR_MESSAGES.NO_OUTPUT)).toBe(false);
  });
});

describe("executeAntigravityCLI model-unavailable recovery (#243)", () => {
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

describe("executeAntigravityCLI concurrency", () => {
  it("holds the base-directory lock while snapshotting, invoking agy, and resolving the transcript", async () => {
    const lockPath = antigravityInvocationLockPath(baseDir);
    mockSnapshotTranscriptState.mockImplementation(() => {
      expect(existsSync(lockPath)).toBe(true);
      return { baseDir, transcripts: {} };
    });
    mockExec.mockImplementation(async () => {
      expect(existsSync(lockPath)).toBe(true);
      const owner = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8")) as {
        leaseDurationMs?: number;
      };
      expect(owner.leaseDurationMs).toBe(ANTIGRAVITY.DEFAULT_TIMEOUT_MS * 3 + 30_000);
      return "";
    });
    mockReadLatestTranscript.mockImplementation(() => {
      expect(existsSync(lockPath)).toBe(true);
      return {
        response: "correlated answer",
        path: join(baseDir, "brain", "conversation-1", "transcript.jsonl"),
        conversationId: "conversation-1",
      };
    });

    await expect(executeAntigravityCLI({ prompt: "q" })).resolves.toMatchObject({ response: "correlated answer" });
    expect(mockSnapshotTranscriptState.mock.invocationCallOrder[0]).toBeLessThan(mockExec.mock.invocationCallOrder[0]);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("preserves a lease covering three one-hour attempts plus cleanup grace", async () => {
    process.env[ANTIGRAVITY.TIMEOUT_ENV_VAR] = "3600000";
    const lockPath = antigravityInvocationLockPath(baseDir);
    mockExec.mockImplementation(async () => {
      const owner = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8")) as {
        leaseDurationMs?: number;
      };
      expect(owner.leaseDurationMs).toBe(10_830_000);
      return "answer";
    });

    await expect(executeAntigravityCLI({ prompt: "q" })).resolves.toMatchObject({ response: "answer" });
    expect(existsSync(lockPath)).toBe(false);
  });

  it("holds the lock across the worst case: rate-limit fallback then model-less recovery", async () => {
    const lockPath = antigravityInvocationLockPath(baseDir);
    mockExec
      .mockImplementationOnce(async () => {
        expect(existsSync(lockPath)).toBe(true);
        throw new Error("RESOURCE_EXHAUSTED: quota");
      })
      .mockImplementationOnce(async () => {
        expect(existsSync(lockPath)).toBe(true);
        throw unknownModelError(MODELS.FALLBACK);
      })
      .mockImplementationOnce(async () => {
        expect(existsSync(lockPath)).toBe(true);
        return "rescued";
      });

    await expect(executeAntigravityCLI({ prompt: "q" })).resolves.toMatchObject({ response: "rescued" });
    expect(mockExec).toHaveBeenCalledTimes(3);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("removes the base-directory lock when agy fails", async () => {
    const lockPath = antigravityInvocationLockPath(baseDir);
    mockExec.mockImplementation(async () => {
      expect(existsSync(lockPath)).toBe(true);
      throw new Error("agy failed");
    });

    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow("agy failed");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("serializes concurrent calls via the mutex (never more than one agy active)", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    mockExec.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          releases.push(() => {
            active--;
            resolve("answer");
          });
        }),
    );
    const waitForReleases = async (count: number) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (releases.length === count) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error(`Timed out waiting for ${count} agy invocation(s)`);
    };
    const p1 = executeAntigravityCLI({ prompt: "a" });
    const p2 = executeAntigravityCLI({ prompt: "b" });
    await waitForReleases(1);
    expect(releases.length).toBe(1); // only the first call has reached agy
    expect(maxActive).toBe(1);
    releases[0]();
    await waitForReleases(2);
    expect(releases.length).toBe(2); // second starts only after the first finished
    releases[1]();
    await Promise.all([p1, p2]);
    expect(maxActive).toBe(1);
  });
});
