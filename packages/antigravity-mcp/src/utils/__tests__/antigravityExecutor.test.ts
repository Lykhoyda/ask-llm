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
  readLatestResponse: vi.fn(),
}));

import { executeCommand } from "@ask-llm/shared";
import { buildArgs, executeAntigravityCLI } from "../antigravityExecutor.js";
import { readLatestResponse } from "../transcriptReader.js";

const mockExec = vi.mocked(executeCommand);
const mockReadLatest = vi.mocked(readLatestResponse);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env[ANTIGRAVITY.SANDBOX_ENV_VAR];
  delete process.env[ANTIGRAVITY.TIMEOUT_ENV_VAR];
  delete process.env[ANTIGRAVITY.MODEL_ENV_VAR];
  mockExec.mockResolvedValue("");
  mockReadLatest.mockReturnValue(null);
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
    mockReadLatest.mockReturnValue(null);
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("direct answer");
    // transcript is consulted before plain stdout
    expect(mockReadLatest).toHaveBeenCalledOnce();
  });

  it("prefers the transcript over non-JSON stdout banners (#153)", async () => {
    mockExec.mockResolvedValue("Initializing model...");
    mockReadLatest.mockReturnValue("real answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("real answer");
  });

  it("uses JSON stdout .response when present", async () => {
    mockExec.mockResolvedValue('{"response":"json answer"}');
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("json answer");
    expect(mockReadLatest).not.toHaveBeenCalled();
  });

  it("falls back to transcript scrape when stdout is empty (today's bug)", async () => {
    mockExec.mockResolvedValue("");
    mockReadLatest.mockReturnValue("scraped answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("scraped answer");
    expect(mockReadLatest).toHaveBeenCalledOnce();
    expect(typeof mockReadLatest.mock.calls[0][0]).toBe("number");
  });

  it("throws NO_OUTPUT when stdout is empty and no transcript is found", async () => {
    mockExec.mockResolvedValue("");
    mockReadLatest.mockReturnValue(null);
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
    process.env[ANTIGRAVITY.MODEL_ENV_VAR] = "Gemini 3.1 Pro (High)";
    mockExec.mockResolvedValue("answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    const idx = args.indexOf(CLI.FLAGS.MODEL);
    expect(args[idx + 1]).toBe("Gemini 3.1 Pro (High)");
    expect(result.model).toBe("Gemini 3.1 Pro (High)");
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
  it("translates rate-limit errors to the actionable message", async () => {
    mockExec.mockRejectedValue(new Error("RESOURCE_EXHAUSTED: quota"));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.RATE_LIMITED);
  });

  it("rethrows non-rate-limit errors unchanged", async () => {
    mockExec.mockRejectedValue(new Error("agy CLI not found on PATH"));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow("agy CLI not found on PATH");
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
