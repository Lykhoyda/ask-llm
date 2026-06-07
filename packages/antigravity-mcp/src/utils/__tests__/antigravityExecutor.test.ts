import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANTIGRAVITY, CLI, ERROR_MESSAGES, READ_ONLY_PREAMBLE } from "../../constants.js";

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
  mockExec.mockResolvedValue("");
  mockReadLatest.mockReturnValue(null);
});

describe("buildArgs", () => {
  it("builds -p, prompt, print-timeout, skip-permissions, sandbox", () => {
    const args = buildArgs("hello", undefined, 295, true);
    expect(args).toEqual([
      CLI.FLAGS.PRINT,
      "hello",
      CLI.FLAGS.PRINT_TIMEOUT,
      "295s",
      CLI.FLAGS.SKIP_PERMISSIONS,
      CLI.FLAGS.SANDBOX,
    ]);
  });

  it("omits sandbox when disabled and repeats --add-dir per includeDir", () => {
    const args = buildArgs("hello", ["/a", "/b"], 100, false);
    expect(args).toEqual([
      CLI.FLAGS.PRINT,
      "hello",
      CLI.FLAGS.ADD_DIR,
      "/a",
      CLI.FLAGS.ADD_DIR,
      "/b",
      CLI.FLAGS.PRINT_TIMEOUT,
      "100s",
      CLI.FLAGS.SKIP_PERMISSIONS,
    ]);
  });
});

describe("executeAntigravityCLI response sources", () => {
  it("uses plain stdout when agy prints (future-proof path)", async () => {
    mockExec.mockResolvedValue("direct answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("direct answer");
    expect(mockReadLatest).not.toHaveBeenCalled();
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
  it("serializes concurrent calls via the mutex", async () => {
    let resolveFirst!: (v: string) => void;
    const first = new Promise<string>((r) => {
      resolveFirst = r;
    });
    mockExec.mockReturnValueOnce(first).mockResolvedValueOnce("second");
    const p1 = executeAntigravityCLI({ prompt: "a" });
    const p2 = executeAntigravityCLI({ prompt: "b" });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExec).toHaveBeenCalledTimes(1); // second call queued behind the mutex
    resolveFirst("first");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.response).toBe("first");
    expect(r2.response).toBe("second");
    expect(mockExec).toHaveBeenCalledTimes(2);
  });
});
