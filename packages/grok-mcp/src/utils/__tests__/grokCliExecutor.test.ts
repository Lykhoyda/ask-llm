import { beforeEach, describe, expect, it, vi } from "vitest";

const executeCommandMock = vi.hoisted(() => vi.fn());
vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return { ...actual, executeCommand: executeCommandMock };
});

import { executeGrokCLI, listGrokCliModels, probeGrokCli } from "../grokCliExecutor.js";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ASK_GROK_TIMEOUT_MS;
  executeCommandMock.mockResolvedValue(
    JSON.stringify({
      model: "grok-4.6",
      response: "CLI review",
      usage: { input_tokens: 20, output_tokens: 8, reasoning_tokens: 3 },
    }),
  );
});

describe("Grok CLI harness", () => {
  it("uses headless JSON, exact model, read-only sandbox, bounded turns, and no auto-update", async () => {
    await executeGrokCLI({ prompt: "review", model: "grok-4.6", reasoningEffort: "xhigh" });

    const [command, args, , , stdin, , logging] = executeCommandMock.mock.calls[0];
    expect(command).toBe("grok");
    expect(args).toEqual([
      "--no-auto-update",
      "-p",
      "review",
      "--output-format",
      "json",
      "--model",
      "grok-4.6",
      "--effort",
      "xhigh",
      "--sandbox",
      "read-only",
      "--max-turns",
      "1",
      "--no-subagents",
      "--no-memory",
      "--disable-web-search",
    ]);
    expect(stdin).toBeUndefined();
    expect(logging).toEqual({ sensitiveValues: ["review"] });
  });

  it("passes the Grok-specific timeout to the cancellable command boundary", async () => {
    process.env.ASK_GROK_TIMEOUT_MS = "3210";
    await executeGrokCLI({ prompt: "review" });
    expect(executeCommandMock.mock.calls[0][5]).toBe(3210);
  });

  it("returns the CLI-reported model and normalized usage without fallback", async () => {
    const result = await executeGrokCLI({ prompt: "review" });
    expect(result).toMatchObject({
      model: "grok-4.6",
      harness: "grok-cli",
      usage: { provider: "grok", thinkingTokens: 3, fellBack: false },
    });
    expect(result.response).toContain("CLI review");
  });

  it("propagates cancellation to the command boundary", async () => {
    const controller = new AbortController();
    executeCommandMock.mockRejectedValueOnce(new DOMException("cancelled", "AbortError"));
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(executeGrokCLI({ prompt: "review", signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(executeCommandMock.mock.calls[0][7]).toBe(controller.signal);
  });

  it("normalizes auth, model, quota, safety, and malformed output without retry", async () => {
    for (const [raw, pattern] of [
      ["401 unauthorized api key", /authentication failed/],
      ["unknown model selected", /model .* unavailable/],
      ["429 rate limit", /quota, credits, or rate limit/],
      ["content policy refusal", /safety/],
    ] as const) {
      executeCommandMock.mockRejectedValueOnce(new Error(raw));
      await expect(executeGrokCLI({ prompt: raw })).rejects.toThrow(pattern);
    }

    executeCommandMock.mockResolvedValueOnce("not json");
    await expect(executeGrokCLI({ prompt: "malformed" })).rejects.toThrow(/malformed JSON/);
    expect(executeCommandMock).toHaveBeenCalledTimes(5);
  });

  it("constrains the prompt to the requested JSON Schema and returns only validated structured output", async () => {
    const outputSchema = {
      type: "object",
      properties: { verdict: { type: "string" }, score: { type: "integer" } },
      required: ["verdict", "score"],
      additionalProperties: false,
    };
    executeCommandMock.mockResolvedValueOnce(
      JSON.stringify({ model: "grok-build", response: 'Sure:\n```json\n{"verdict":"ship","score":9}\n```' }),
    );

    const result = await executeGrokCLI({ prompt: "judge", outputSchema });

    const [, args, , , , , logging] = executeCommandMock.mock.calls[0];
    expect(args[2]).toBe(
      `judge\n\nReturn only one JSON object matching this JSON Schema: ${JSON.stringify(outputSchema)}`,
    );
    expect(logging).toEqual({ sensitiveValues: [args[2]] });
    expect(result.response.startsWith('{"verdict":"ship","score":9}')).toBe(true);
    expect(JSON.parse(result.response.slice(0, result.response.indexOf("}") + 1))).toEqual({
      verdict: "ship",
      score: 9,
    });
  });

  it("rejects CLI output that violates the requested JSON Schema without retrying", async () => {
    const outputSchema = {
      type: "object",
      properties: { verdict: { type: "string" } },
      required: ["verdict"],
      additionalProperties: false,
    };
    executeCommandMock.mockResolvedValueOnce(JSON.stringify({ response: '{"verdict":42}' }));

    await expect(executeGrokCLI({ prompt: "judge", outputSchema })).rejects.toThrow(
      /Grok CLI output did not match the requested JSON Schema \(verdict: .*\).*No fallback was attempted/,
    );
    expect(executeCommandMock).toHaveBeenCalledOnce();
  });

  it("capability-probes the official headless flags and parses model discovery", async () => {
    executeCommandMock.mockResolvedValueOnce("--single --output-format --model --sandbox");
    await expect(probeGrokCli()).resolves.toBe(true);

    executeCommandMock.mockResolvedValueOnce("grok-build  Grok Build\ngrok-4.6  Grok 4.6\n");
    await expect(listGrokCliModels()).resolves.toEqual(["grok-build", "grok-4.6"]);
  });
});
