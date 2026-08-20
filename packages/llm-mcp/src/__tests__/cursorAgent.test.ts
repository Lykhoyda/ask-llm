import { beforeEach, describe, expect, it, vi } from "vitest";

const executeCommandMock = vi.hoisted(() => vi.fn());
vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return { ...actual, executeCommand: executeCommandMock };
});

import {
  CURSOR_PROVIDERS,
  CURSOR_STDIN_THRESHOLD_BYTES,
  cursorModelFamily,
  executeCursorAgent,
  listCursorModels,
  probeCursorAgent,
} from "../cursorAgent.js";

function stream(model = "cursor-grok-4.6-high", result = "Cursor review"): string {
  return [
    JSON.stringify({ type: "system", subtype: "init", model, session_id: "session-fixture" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: result }] } }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      result,
      usage: { input_tokens: 10, output_tokens: 4, reasoning_tokens: 2 },
    }),
  ].join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ASK_CURSOR_TIMEOUT_MS;
  executeCommandMock.mockResolvedValue(stream());
});

describe("model-neutral Cursor Agent harness", () => {
  it("keeps provider and exact model separate while enforcing read-only ask mode", async () => {
    const result = await executeCursorAgent({
      provider: "grok",
      model: "cursor-grok-4.6-high",
      prompt: "review",
    });
    const [command, args, , , stdin, , logging] = executeCommandMock.mock.calls[0];

    expect(command).toBe("agent");
    expect(args).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--mode",
      "ask",
      "--model",
      "cursor-grok-4.6-high",
      "review",
    ]);
    expect(args).not.toContain("--force");
    expect(args).not.toContain("--trust");
    expect(stdin).toBeUndefined();
    expect(logging).toEqual({ sensitiveValues: ["review"] });
    expect(result).toMatchObject({
      provider: "grok",
      model: "cursor-grok-4.6-high",
      harness: "cursor-agent",
      usage: { provider: "grok", fellBack: false },
    });
  });

  it("passes the Cursor-specific timeout to the cancellable command boundary", async () => {
    process.env.ASK_CURSOR_TIMEOUT_MS = "4321";
    await executeCursorAgent({ provider: "grok", model: "cursor-grok-4.6-high", prompt: "review" });
    expect(executeCommandMock.mock.calls[0][5]).toBe(4321);
  });

  it("is model-neutral and preserves a non-Grok provider/model pair", async () => {
    executeCommandMock.mockResolvedValueOnce(stream("claude-opus-5-thinking-high", "Claude via Cursor"));
    const result = await executeCursorAgent({
      provider: "claude",
      model: "claude-opus-5-thinking-high",
      prompt: "review",
    });
    expect(result.provider).toBe("claude");
    expect(result.model).toBe("claude-opus-5-thinking-high");
    expect(result.response).toContain("Claude via Cursor");
  });

  it("requires an explicit model rather than using Cursor Auto or rewriting", async () => {
    await expect(executeCursorAgent({ provider: "grok", model: " ", prompt: "review" })).rejects.toThrow(
      /requires an exact model ID/,
    );
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("forwards cancellation to the command process", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    executeCommandMock.mockRejectedValueOnce(controller.signal.reason);
    await expect(
      executeCursorAgent({
        provider: "grok",
        model: "cursor-grok-4.6-high",
        prompt: "review",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(executeCommandMock.mock.calls[0][7]).toBe(controller.signal);
  });

  it("normalizes auth, model, quota, trust, and malformed-response failures without retry", async () => {
    for (const [raw, pattern] of [
      ["401 unauthorized api key", /authentication failed/],
      ["unknown model selected", /model .* unavailable/],
      ["429 spend limit", /quota or spend limit/],
      ["workspace trust required", /requires this workspace to be trusted/],
    ] as const) {
      executeCommandMock.mockRejectedValueOnce(new Error(raw));
      await expect(
        executeCursorAgent({ provider: "grok", model: "cursor-grok-4.6-high", prompt: raw }),
      ).rejects.toThrow(pattern);
    }
    executeCommandMock.mockResolvedValueOnce("not-json");
    await expect(
      executeCursorAgent({ provider: "grok", model: "cursor-grok-4.6-high", prompt: "bad" }),
    ).rejects.toThrow(/malformed JSON/);
    expect(executeCommandMock).toHaveBeenCalledTimes(5);
  });

  it("capability-probes the harness and discovers exact account model IDs", async () => {
    executeCommandMock.mockResolvedValueOnce("--output-format --mode --model");
    await expect(probeCursorAgent()).resolves.toBe(true);

    executeCommandMock.mockResolvedValueOnce(
      "Available models\n\ncursor-grok-4.6-high - Cursor Grok 4.6\nclaude-opus-5-thinking-high - Claude Opus 5\n",
    );
    await expect(listCursorModels()).resolves.toEqual(["cursor-grok-4.6-high", "claude-opus-5-thinking-high"]);
  });

  it("routes prompts above the byte threshold over stdin instead of argv", async () => {
    const prompt = "x".repeat(CURSOR_STDIN_THRESHOLD_BYTES + 1);
    await executeCursorAgent({ provider: "grok", model: "cursor-grok-4.6-high", prompt });
    const [, args, , , stdin, , logging] = executeCommandMock.mock.calls[0];
    expect(args).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--mode",
      "ask",
      "--model",
      "cursor-grok-4.6-high",
    ]);
    expect(stdin).toBe(prompt);
    expect(logging).toEqual({ sensitiveValues: [] });
  });

  it("keeps a prompt at the byte threshold on argv and counts bytes, not characters", async () => {
    const atThreshold = "x".repeat(CURSOR_STDIN_THRESHOLD_BYTES);
    await executeCursorAgent({ provider: "grok", model: "cursor-grok-4.6-high", prompt: atThreshold });
    expect(executeCommandMock.mock.calls[0][1]).toContain(atThreshold);
    expect(executeCommandMock.mock.calls[0][4]).toBeUndefined();

    const multibyte = "é".repeat(CURSOR_STDIN_THRESHOLD_BYTES / 2 + 1);
    await executeCursorAgent({ provider: "grok", model: "cursor-grok-4.6-high", prompt: multibyte });
    expect(executeCommandMock.mock.calls[1][4]).toBe(multibyte);
  });

  it("explains a CLI that cannot read the stdin prompt without retrying on argv", async () => {
    executeCommandMock.mockRejectedValueOnce(new Error("error: missing required argument 'prompt'"));
    await expect(
      executeCursorAgent({
        provider: "grok",
        model: "cursor-grok-4.6-high",
        prompt: "y".repeat(CURSOR_STDIN_THRESHOLD_BYTES + 1),
      }),
    ).rejects.toThrow(/did not accept a prompt larger than .* over stdin.*Update Cursor CLI.*No fallback/);
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
  });
});

describe("Cursor provider attribution is verified against the model family", () => {
  it("exposes the canonical Cursor provider families", () => {
    expect(CURSOR_PROVIDERS).toEqual(["claude", "codex", "gemini", "grok"]);
  });

  it.each([
    ["cursor-grok-4.6-high", "grok"],
    ["grok4", "grok"],
    ["claude-opus-5-thinking-high", "claude"],
    ["sonnet-4.5", "claude"],
    ["gpt-5.2-high", "codex"],
    ["gpt5.2", "codex"],
    ["o3-pro", "codex"],
    ["gemini-3-pro", "gemini"],
  ])("maps %s to provider %s", (model, provider) => {
    expect(cursorModelFamily(model)).toBe(provider);
  });

  it.each(["auto", "composer-1", "cursor-small", "grokking-2"])("treats %s as noncanonical", (model) => {
    expect(cursorModelFamily(model)).toBeNull();
  });

  it("refuses a requested model from another provider family before spawning", async () => {
    await expect(
      executeCursorAgent({ provider: "claude", model: "cursor-grok-4.6-high", prompt: "review" }),
    ).rejects.toThrow(/belongs to provider "grok", not the requested provider "claude".*No fallback/);
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("refuses Cursor Auto and other noncanonical catalog IDs before spawning", async () => {
    await expect(executeCursorAgent({ provider: "grok", model: "auto", prompt: "review" })).rejects.toThrow(
      /does not belong to a canonical provider family \(claude, codex, gemini, grok\).*No fallback/,
    );
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("refuses a non-Cursor provider such as ollama", async () => {
    await expect(
      executeCursorAgent({ provider: "ollama" as never, model: "cursor-grok-4.6-high", prompt: "review" }),
    ).rejects.toThrow(/not a canonical Cursor catalog provider/);
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("refuses when the CLI reports a model from a different family than the requested provider", async () => {
    executeCommandMock.mockResolvedValueOnce(stream("claude-opus-5-thinking-high", "served by claude"));
    await expect(
      executeCursorAgent({ provider: "grok", model: "cursor-grok-4.6-high", prompt: "review" }),
    ).rejects.toThrow(/reported model "claude-opus-5-thinking-high" belongs to provider "claude"/);
  });

  it("refuses when the CLI silently resolves the request to a noncanonical model", async () => {
    executeCommandMock.mockResolvedValueOnce(stream("auto", "served by auto"));
    await expect(
      executeCursorAgent({ provider: "grok", model: "cursor-grok-4.6-high", prompt: "review" }),
    ).rejects.toThrow(/reported model "auto" does not belong to a canonical provider family/);
  });

  it("accepts a CLI-reported model in the same family and reports it truthfully", async () => {
    executeCommandMock.mockResolvedValueOnce(stream("grok-4.6", "served"));
    const result = await executeCursorAgent({ provider: "grok", model: "cursor-grok-4.6-high", prompt: "review" });
    expect(result.model).toBe("grok-4.6");
    expect(result.usage.model).toBe("grok-4.6");
  });
});
