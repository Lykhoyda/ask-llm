import { beforeEach, describe, expect, it, vi } from "vitest";

const executeCommandMock = vi.hoisted(() => vi.fn());
vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return { ...actual, executeCommand: executeCommandMock };
});

import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  executeGrokCLI,
  GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES,
  listGrokCliModels,
  probeGrokCli,
  probeGrokPromptFileSupport,
} from "../grokCliExecutor.js";
import { constrainPromptToSchema } from "../structuredOutput.js";

const HELP_WITHOUT_PROMPT_FILE =
  "-p, --prompt <TEXT>  --single --output-format <FORMAT> --model <MODEL> --sandbox <PROFILE>";
const HELP_WITH_PROMPT_FILE = `${HELP_WITHOUT_PROMPT_FILE} --prompt-file <PATH>  Read the prompt from a file`;

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
      reportedModel: "grok-4.6",
      harness: "grok-cli",
      usage: { provider: "grok", thinkingTokens: 3, fellBack: false },
    });
    expect(result.response).toContain("CLI review");
  });

  it("keeps the requested model effective but leaves reportedModel empty when the CLI omits it", async () => {
    executeCommandMock.mockResolvedValueOnce(JSON.stringify({ response: "no model field" }));
    const result = await executeGrokCLI({ prompt: "review", model: "grok-build" });
    expect(result).toMatchObject({ model: "grok-build", reportedModel: undefined, harness: "grok-cli" });
    expect(result.usage.model).toBe("grok-build");
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

  it("constrains the prompt to the requested JSON Schema and returns the raw structured reply unchanged", async () => {
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
    expect(result.response.startsWith('Sure:\n```json\n{"verdict":"ship","score":9}\n```')).toBe(true);
    expect(result.model).toBe("grok-build");
  });

  it("capability-probes the official headless flags and parses model discovery", async () => {
    executeCommandMock.mockResolvedValueOnce("--single --output-format --model --sandbox");
    await expect(probeGrokCli()).resolves.toBe(true);

    executeCommandMock.mockResolvedValueOnce("grok-build  Grok Build\ngrok-4.6  Grok 4.6\n");
    await expect(listGrokCliModels()).resolves.toEqual(["grok-build", "grok-4.6"]);
  });

  it("does not embed the schema constraint twice when the machine layer already appended it", async () => {
    const outputSchema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
    const preConstrained = constrainPromptToSchema("judge", outputSchema);
    await executeGrokCLI({ prompt: preConstrained, outputSchema });
    const args: string[] = executeCommandMock.mock.calls[0][1];
    expect(args[2]).toBe(preConstrained);
    expect(args[2].split("Return only one JSON object matching this JSON Schema").length).toBe(2);
  });

  it("hands prompts above the byte threshold to an advertising CLI through a private --prompt-file and cleans it up", async () => {
    const prompt = "p".repeat(GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES + 1);
    let observedPath = "";
    let observedContent = "";
    executeCommandMock.mockResolvedValueOnce(HELP_WITH_PROMPT_FILE);
    executeCommandMock.mockImplementationOnce(async (_command: string, args: string[]) => {
      observedPath = args[args.indexOf("--prompt-file") + 1];
      observedContent = readFileSync(observedPath, "utf8");
      return JSON.stringify({ model: "grok-build", response: "ok" });
    });

    await executeGrokCLI({ prompt });

    expect(executeCommandMock).toHaveBeenCalledTimes(2);
    expect(executeCommandMock.mock.calls[0].slice(0, 2)).toEqual(["grok", ["--help"]]);
    const [command, args, , , stdin, , logging] = executeCommandMock.mock.calls[1];
    expect(command).toBe("grok");
    expect(args.slice(0, 3)).toEqual(["--no-auto-update", "--prompt-file", observedPath]);
    expect(args).not.toContain("-p");
    expect(args).not.toContain(prompt);
    expect(stdin).toBeUndefined();
    expect(logging).toEqual({ sensitiveValues: [] });
    expect(observedContent).toBe(prompt);
    expect(existsSync(observedPath)).toBe(false);
    expect(existsSync(dirname(observedPath))).toBe(false);
  });

  it("counts UTF-8 bytes for the prompt-file threshold and keeps threshold-sized prompts on argv without probing", async () => {
    const atThreshold = "p".repeat(GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES);
    await executeGrokCLI({ prompt: atThreshold });
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    expect(executeCommandMock.mock.calls[0][1].slice(1, 3)).toEqual(["-p", atThreshold]);

    executeCommandMock.mockResolvedValueOnce(HELP_WITH_PROMPT_FILE);
    const multibyte = "é".repeat(GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES / 2 + 1);
    await executeGrokCLI({ prompt: multibyte });
    expect(executeCommandMock.mock.calls[1][1]).toEqual(["--help"]);
    expect(executeCommandMock.mock.calls[2][1]).toContain("--prompt-file");
  });

  it("rejects a large prompt before spawning when the installed CLI does not advertise --prompt-file", async () => {
    executeCommandMock.mockResolvedValueOnce(HELP_WITHOUT_PROMPT_FILE);
    const prompt = "q".repeat(GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES + 1);
    const message = await executeGrokCLI({ prompt }).catch((error: Error) => error.message);
    expect(message).toMatch(/does not advertise --prompt-file in `grok --help`/);
    expect(message).toMatch(/Update Grok Build \(1\.0\.5 and later document --prompt-file\) or shorten the prompt/);
    expect(message).toMatch(/does not retry large prompts on argv/);
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    expect(executeCommandMock.mock.calls[0][1]).toEqual(["--help"]);
  });

  it("reports a missing harness when the capability probe itself cannot run", async () => {
    executeCommandMock.mockRejectedValueOnce(new Error("spawn grok ENOENT"));
    await expect(executeGrokCLI({ prompt: "q".repeat(GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES + 1) })).rejects.toThrow(
      /Grok CLI harness is unavailable/,
    );
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
  });

  it("forwards cancellation to the capability probe", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    executeCommandMock.mockRejectedValueOnce(controller.signal.reason);
    await expect(
      executeGrokCLI({ prompt: "q".repeat(GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES + 1), signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(executeCommandMock.mock.calls[0][7]).toBe(controller.signal);
  });

  it("removes the prompt file and explains a CLI that still rejects --prompt-file without retrying on argv", async () => {
    let observedPath = "";
    executeCommandMock.mockResolvedValueOnce(HELP_WITH_PROMPT_FILE);
    executeCommandMock.mockImplementationOnce(async (_command: string, args: string[]) => {
      observedPath = args[args.indexOf("--prompt-file") + 1];
      throw new Error("error: unexpected argument '--prompt-file' found");
    });
    await expect(executeGrokCLI({ prompt: "q".repeat(GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES + 1) })).rejects.toThrow(
      /rejected --prompt-file.*Update Grok Build.*No fallback/,
    );
    expect(executeCommandMock).toHaveBeenCalledTimes(2);
    expect(existsSync(observedPath)).toBe(false);
  });

  it("exposes the --prompt-file capability probe against the installed help output", async () => {
    executeCommandMock.mockResolvedValueOnce(HELP_WITH_PROMPT_FILE);
    await expect(probeGrokPromptFileSupport()).resolves.toBe(true);
    executeCommandMock.mockResolvedValueOnce(HELP_WITHOUT_PROMPT_FILE);
    await expect(probeGrokPromptFileSupport()).resolves.toBe(false);
  });
});
