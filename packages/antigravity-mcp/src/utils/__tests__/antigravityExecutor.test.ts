import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANTIGRAVITY, CLI, ERROR_MESSAGES, MODELS, READ_ONLY_PREAMBLE } from "../../constants.js";

vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return {
    ...actual,
    executeCommand: vi.fn(),
    Logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
});

vi.mock("../transcriptReader.js", () => ({
  readLatestTranscript: vi.fn(),
}));

import { executeCommand } from "@ask-llm/shared";
import { buildArgs, executeAntigravityCLI } from "../antigravityExecutor.js";
import { readLatestTranscript } from "../transcriptReader.js";

const mockExec = vi.mocked(executeCommand);
const mockReadLatestTranscript = vi.mocked(readLatestTranscript);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env[ANTIGRAVITY.SANDBOX_ENV_VAR];
  delete process.env[ANTIGRAVITY.TIMEOUT_ENV_VAR];
  delete process.env[ANTIGRAVITY.MODEL_ENV_VAR];
  mockExec.mockResolvedValue("");
  mockReadLatestTranscript.mockReturnValue(null);
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

describe("executeAntigravityCLI concurrency", () => {
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
    const p1 = executeAntigravityCLI({ prompt: "a" });
    const p2 = executeAntigravityCLI({ prompt: "b" });
    await new Promise((r) => setTimeout(r, 0));
    expect(releases.length).toBe(1); // only the first call has reached agy
    expect(maxActive).toBe(1);
    releases[0]();
    await new Promise((r) => setTimeout(r, 0));
    expect(releases.length).toBe(2); // second starts only after the first finished
    releases[1]();
    await Promise.all([p1, p2]);
    expect(maxActive).toBe(1);
  });
});
