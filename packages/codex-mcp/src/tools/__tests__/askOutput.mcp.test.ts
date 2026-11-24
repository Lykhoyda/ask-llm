import { existsSync, readFileSync } from "node:fs";
import { executeCommand, registerTools, responseCache } from "@ask-llm/shared";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLI, MODELS } from "../../constants.js";
import { askCodexTool } from "../ask-codex.tool.js";
import { askCodexWriteTool } from "../ask-codex-write.tool.js";

vi.mock("@ask-llm/shared", async (original) => ({
  ...(await original<typeof import("@ask-llm/shared")>()),
  executeCommand: vi.fn(),
}));

vi.mock("../../utils/codexVersion.js", async (original) => ({
  ...(await original<typeof import("../../utils/codexVersion.js")>()),
  assertCodexSupportsModel: vi.fn().mockResolvedValue("0.167.0"),
}));

const command = vi.mocked(executeCommand);
const schema = {
  type: "object",
  properties: { verdict: { $ref: "#/$defs/verdict" } },
  required: ["verdict"],
  additionalProperties: false,
  $defs: { verdict: { type: "string", enum: ["pass", "revise"] } },
};
const reply = '{"verdict":"pass"}';

function completedTurn(text: string) {
  return [
    { type: "thread.started", thread_id: "test-thread" },
    { type: "turn.started" },
    { type: "item.completed", item: { type: "agent_message", text } },
    { type: "turn.completed", usage: { input_tokens: 12, output_tokens: 8 } },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n");
}

function schemaPath(args: string[]) {
  const index = args.indexOf(CLI.FLAGS.OUTPUT_SCHEMA);
  expect(index).toBeGreaterThanOrEqual(0);
  return args[index + 1];
}

describe("ask-codex structured replies over MCP", () => {
  const tools = [askCodexTool, askCodexWriteTool];
  let client: Client;
  let server: McpServer;
  const ask = (args: Record<string, unknown>) =>
    client.callTool({ name: askCodexTool.name, arguments: { prompt: "Review this change", ...args } });

  beforeEach(async () => {
    command.mockReset();
    responseCache.clear();
    client = new Client({ name: "ask-output-client", version: "1.0.0" });
    server = new McpServer({ name: "ask-output-server", version: "1.0.0" });
    registerTools({
      server,
      tools,
      executeTool: (name, args, onProgress, onUsage, signal) =>
        tools.find((tool) => tool.name === name)?.execute(args, onProgress, onUsage, signal) ??
        Promise.reject(new Error(`Unexpected tool: ${name}`)),
      getPromptMessage: () => "Review",
      progressMessages: () => ["Reviewing"],
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("advertises the schema and returns validated JSON alongside the raw reply and usage", async () => {
    const listed = await client.listTools();
    const askTool = listed.tools.find((tool) => tool.name === askCodexTool.name);
    expect(askTool?.inputSchema.properties?.outputSchema).toMatchObject({ type: "object" });
    expect(askTool?.outputSchema?.properties).toHaveProperty("structuredResult");
    const writeTool = listed.tools.find((tool) => tool.name === askCodexWriteTool.name);
    expect(writeTool?.inputSchema.properties).not.toHaveProperty("outputSchema");
    expect(writeTool?.outputSchema?.properties).not.toHaveProperty("structuredResult");

    let outputPath: string | undefined;
    command.mockImplementationOnce(async (_cli, args, _progress, _stderr, stdin) => {
      outputPath = schemaPath(args);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(schema);
      expect(stdin).toBe("Review this change");
      return completedTurn(reply);
    });

    const result = await ask({ outputSchema: schema });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      response: reply,
      structuredResult: { verdict: "pass" },
      usage: { inputTokens: 12, outputTokens: 8 },
    });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining(reply) }]);
    expect(outputPath && existsSync(outputPath)).toBe(false);
    expect(responseCache.size).toBe(0);
  });

  it("surfaces Codex's schema rejection with a correction to try", async () => {
    const invalidSchema = { ...schema, required: [] };
    const message = "Invalid schema for response_format: 'required' must include 'verdict'.";
    command.mockResolvedValueOnce(
      [
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Starting review." } }),
        JSON.stringify({ type: "turn.failed", error: { message } }),
      ].join("\n"),
    );

    const result = await ask({ outputSchema: invalidSchema });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining(message) }]);
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("include every property in required") },
    ]);
    expect(command).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['{"verdict":"unknown"}', "/verdict"],
    ["  A reply that isn't JSON.\n", "Could not parse"],
    ["", "Could not parse"],
  ])("keeps the exact raw reply %j on validation failure", async (raw, diagnostic) => {
    command.mockResolvedValueOnce(completedTurn(raw));

    const result = await ask({ outputSchema: schema });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      response: raw,
      validationError: expect.stringContaining(diagnostic),
    });
    expect(result.structuredContent).not.toHaveProperty("structuredResult");
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining(raw) }]);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining(diagnostic) }]);
  });

  it("preserves a resumed session and reuses its schema on the quota fallback", async () => {
    command.mockRejectedValueOnce(new Error("rate_limit_exceeded")).mockResolvedValueOnce(completedTurn(reply));

    const result = await ask({ outputSchema: schema, sessionId: "test-thread" });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      sessionId: "test-thread",
      model: MODELS.FALLBACK,
      structuredResult: { verdict: "pass" },
      usage: { fellBack: true },
    });
    expect(command).toHaveBeenCalledTimes(2);
    const [, initialArgs] = command.mock.calls[0];
    const [, fallbackArgs] = command.mock.calls[1];
    expect(initialArgs).toContain("resume");
    expect(fallbackArgs).toContain("test-thread");
    expect(schemaPath(initialArgs)).toBe(schemaPath(fallbackArgs));
  });

  it("honors noFallback on structured calls", async () => {
    command.mockRejectedValueOnce(new Error("rate_limit_exceeded"));

    const result = await ask({ outputSchema: schema, noFallback: true, preferred: true });
    expect(result.isError).toBe(true);
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0][1]).toContain(MODELS.DEFAULT);
  });

  it("keeps the original text, response envelope, and cache for calls without a schema", async () => {
    command.mockResolvedValueOnce(completedTurn("Plain reply"));
    const result = await ask({});
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      provider: "codex",
      response: "Plain reply\n\n[Codex stats: 12 input tokens, 8 output tokens]",
      model: MODELS.DEFAULT,
      reasoningEffort: expect.any(String),
      sessionId: "test-thread",
      usage: {
        provider: "codex",
        model: MODELS.DEFAULT,
        inputTokens: 12,
        outputTokens: 8,
        durationMs: expect.any(Number),
        fellBack: false,
      },
    });
    expect(command.mock.calls[0][1]).not.toContain(CLI.FLAGS.OUTPUT_SCHEMA);
    expect(responseCache.size).toBe(1);
  });
});
