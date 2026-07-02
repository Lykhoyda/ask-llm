import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { UnifiedTool } from "../registry.js";
import { createUsageStatsTool, registerTools } from "../serverFactory.js";
import { createSessionUsage, type UsageStats } from "../usage.js";

function makeStats(overrides: Partial<UsageStats> = {}): UsageStats {
  return {
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    inputTokens: 100,
    outputTokens: 200,
    cachedTokens: 0,
    thinkingTokens: 0,
    durationMs: 1500,
    fellBack: false,
    ...overrides,
  };
}

function makeTool(name: string): UnifiedTool {
  return {
    name,
    description: `${name} test tool`,
    zodSchema: z.object({}),
    annotations: { title: name, readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    category: "simple",
    execute: async () => "ok",
  };
}

describe("registerTools duplicate-name guard", () => {
  it("throws at registration time when two tools share a name", () => {
    const server = { registerTool: vi.fn() } as unknown as McpServer;

    expect(() =>
      registerTools({
        server,
        tools: [makeTool("ping"), makeTool("ping")],
        executeTool: async () => "ok",
        getPromptMessage: () => "",
        progressMessages: () => [],
      }),
    ).toThrow(/duplicate tool name.*ping/i);
  });

  it("registers distinct names without throwing", () => {
    const server = { registerTool: vi.fn() } as unknown as McpServer;

    expect(() =>
      registerTools({
        server,
        tools: [makeTool("ping"), makeTool("pong")],
        executeTool: async () => "ok",
        getPromptMessage: () => "",
        progressMessages: () => [],
      }),
    ).not.toThrow();
  });
});

describe("createUsageStatsTool", () => {
  it("returns a UnifiedTool with correct identity and metadata", () => {
    const session = createSessionUsage();
    const tool = createUsageStatsTool(session);

    expect(tool.name).toBe("get-usage-stats");
    expect(tool.category).toBe("utility");
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.annotations?.idempotentHint).toBe(true);
    expect(tool.annotations?.openWorldHint).toBe(false);
    expect(tool.zodSchema).toBeDefined();
    expect(tool.outputSchema).toBeDefined();
  });

  it("returns structured content matching the outputSchema", async () => {
    const session = createSessionUsage();
    session.record(makeStats({ inputTokens: 100, outputTokens: 200 }));
    session.record(makeStats({ provider: "codex", model: "gpt-5.4", inputTokens: 50, outputTokens: 75 }));

    const tool = createUsageStatsTool(session);
    const result = await tool.execute({});

    expect(typeof result).not.toBe("string");
    if (typeof result === "string") return;

    expect(result.structuredContent).toMatchObject({
      totalCalls: 2,
      totalInputTokens: 150,
      totalOutputTokens: 275,
    });
    expect(result.structuredContent.byProvider).toBeDefined();

    const parsed = (tool.outputSchema as z.ZodType).safeParse(result.structuredContent);
    expect(parsed.success).toBe(true);
  });

  it("returns markdown text alongside structured content", async () => {
    const session = createSessionUsage();
    session.record(makeStats());

    const tool = createUsageStatsTool(session);
    const result = await tool.execute({});

    if (typeof result === "string") throw new Error("Expected structured result");
    expect(result.text).toContain("Session Usage Summary");
    expect(result.text).toContain("Total calls: 1");
  });

  it("returns empty-state structure when no calls recorded", async () => {
    const session = createSessionUsage();
    const tool = createUsageStatsTool(session);
    const result = await tool.execute({});

    if (typeof result === "string") throw new Error("Expected structured result");
    expect(result.structuredContent).toMatchObject({
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      byProvider: {},
      byModel: {},
    });
    expect(result.text).toBe("No LLM calls recorded in this session yet.");
  });

  it("each call to the factory binds a separate accumulator", async () => {
    const sessionA = createSessionUsage();
    const sessionB = createSessionUsage();
    sessionA.record(makeStats({ inputTokens: 100 }));
    sessionB.record(makeStats({ inputTokens: 999 }));

    const toolA = createUsageStatsTool(sessionA);
    const toolB = createUsageStatsTool(sessionB);

    const resultA = await toolA.execute({});
    const resultB = await toolB.execute({});

    if (typeof resultA === "string" || typeof resultB === "string") {
      throw new Error("Expected structured results");
    }
    expect(resultA.structuredContent.totalInputTokens).toBe(100);
    expect(resultB.structuredContent.totalInputTokens).toBe(999);
  });

  it("structuredContent reflects records made after the tool was created", async () => {
    const session = createSessionUsage();
    const tool = createUsageStatsTool(session);

    session.record(makeStats({ inputTokens: 50 }));
    session.record(makeStats({ inputTokens: 75 }));

    const result = await tool.execute({});
    if (typeof result === "string") throw new Error("Expected structured result");
    expect(result.structuredContent.totalInputTokens).toBe(125);
  });
});
