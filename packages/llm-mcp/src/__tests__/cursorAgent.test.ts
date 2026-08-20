import { beforeEach, describe, expect, it, vi } from "vitest";

const executeCommandMock = vi.hoisted(() => vi.fn());
vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return { ...actual, executeCommand: executeCommandMock };
});

import { executeCursorAgent, listCursorModels, probeCursorAgent } from "../cursorAgent.js";

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
});
