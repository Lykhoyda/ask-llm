import { registerTools, askResponseSchema } from "@ask-llm/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect, it, vi } from "vitest";

vi.mock("../../utils/geminiExecutor.js", async (original) => ({
  ...(await original<typeof import("../../utils/geminiExecutor.js")>()),
  executeGeminiCLI: vi.fn().mockResolvedValue({
    response: "**FILE: src/a.ts:1**\n```\nOLD:\na\nNEW:\nb\n```",
    sessionId: "edit-session",
    usage: { provider: "gemini", model: "served-model", durationMs: 1, fellBack: true },
  }),
}));

import { askGeminiEditTool } from "../ask-gemini-edit.tool.js";

it("advertises and delivers validated structured edit proposals over MCP", async () => {
  const tool = askGeminiEditTool;
  const server = new McpServer({ name: "edit-output", version: "1.0.0" });
  registerTools({
    server,
    tools: [tool],
    executeTool: (_name, args, onProgress, onUsage, signal) => tool.execute(args, onProgress, onUsage, signal),
    getPromptMessage: () => "edit",
    progressMessages: () => ["Proposing edits"],
  });
  const client = new Client({ name: "edit-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listTools();
    expect(listed.tools[0].outputSchema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["provider", "response", "model"]),
    });
    const result = await client.callTool({ name: tool.name, arguments: { prompt: "propose changes" } });
    expect(result.isError).toBe(false);
    const structured = askResponseSchema.parse(result.structuredContent);
    expect(structured.response).toContain("src/a.ts");
    expect(structured).toMatchObject({
      provider: "gemini",
      model: "served-model",
      sessionId: "edit-session",
      usage: { fellBack: true },
    });
    expect(result.content).toContainEqual({
      type: "text",
      text: expect.stringContaining(structured.response),
    });
    expect(result.content).toContainEqual({
      type: "text",
      text: expect.stringContaining("edit-session"),
    });
  } finally {
    await client.close();
    await server.close();
  }
});
