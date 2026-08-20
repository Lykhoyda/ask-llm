import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { BaseToolArguments } from "./constants.js";
import { formatDiagnosticReport, type ProviderSpec, runDiagnostics } from "./doctor.js";
import { Logger } from "./logger.js";
import { createProgressTracker } from "./progressTracker.js";
import type { ToolResult, UnifiedTool } from "./registry.js";
import { formatSessionUsage, type SessionUsage, type UsageStats } from "./usage.js";

const diagnosticCheckSchema = z.object({
  name: z.string(),
  status: z.enum(["pass", "warn", "fail", "skip"]),
  message: z.string(),
  fix: z.string().optional(),
});

const diagnosticProviderSchema = z.object({
  name: z.string(),
  command: z.string(),
  available: z.boolean(),
  cliPath: z.string().optional(),
  cliVersion: z.string().optional(),
  error: z.string().optional(),
});

const diagnosticReportSchema = z.object({
  status: z.enum(["ok", "warning", "error"]),
  generatedAt: z.string(),
  environment: z.object({
    nodeVersion: z.string(),
    nodeOk: z.boolean(),
    platform: z.string(),
    arch: z.string(),
    resolvedPath: z.string(),
    askLlmPath: z.string().optional(),
    timeoutMs: z.number(),
    codexTimeoutMs: z.number(),
    claudeTimeoutMs: z.number(),
    geminiTimeoutMs: z.number(),
    grokTimeoutMs: z.number(),
    cursorHarnessTimeoutMs: z.number(),
  }),
  providers: z.array(diagnosticProviderSchema),
  checks: z.array(diagnosticCheckSchema),
});

export function createDiagnoseTool(providers: ProviderSpec[]): UnifiedTool {
  return {
    name: "diagnose",
    description:
      "Run a self-diagnosis of the MCP server's environment: Node version, resolved PATH, provider CLI presence and versions, key env vars. Returns a structured report and a human-readable summary. Read-only; never spawns LLM calls.",
    zodSchema: z.object({}),
    outputSchema: diagnosticReportSchema,
    annotations: {
      title: "Diagnose Environment",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    category: "utility",
    execute: async () => {
      const report = await runDiagnostics(providers);
      return {
        text: formatDiagnosticReport(report),
        structuredContent: report as unknown as Record<string, unknown>,
      };
    },
  };
}

const providerUsageBucketSchema = z.object({
  calls: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedTokens: z.number(),
  thinkingTokens: z.number(),
  durationMs: z.number(),
  fellBack: z.number(),
});

const sessionUsageSnapshotSchema = z.object({
  totalCalls: z.number(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  totalCachedTokens: z.number(),
  totalThinkingTokens: z.number(),
  totalDurationMs: z.number(),
  fallbackCount: z.number(),
  byProvider: z.record(z.string(), providerUsageBucketSchema),
  byModel: z.record(z.string(), providerUsageBucketSchema),
});

export function createUsageStatsTool(sessionUsage: SessionUsage): UnifiedTool {
  return {
    name: "get-usage-stats",
    description:
      "Get the current MCP server's session usage stats: total LLM calls, token totals (input/output/thinking/cached), wall time, and breakdowns per provider and per model. No data leaves your machine — counts are tracked in-memory for the lifetime of the server process. Returns both human-readable markdown and a structured JSON snapshot via outputSchema.",
    zodSchema: z.object({}),
    outputSchema: sessionUsageSnapshotSchema,
    annotations: {
      title: "Get Usage Stats",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    category: "utility",
    execute: async () => {
      const snapshot = sessionUsage.snapshot();
      return {
        text: formatSessionUsage(snapshot),
        structuredContent: snapshot as unknown as Record<string, unknown>,
      };
    },
  };
}

export function registerSessionUsageResource(server: McpServer, sessionUsage: SessionUsage): void {
  server.registerResource(
    "session-usage",
    "usage://current-session",
    {
      title: "Current Session Usage",
      description:
        "Live JSON snapshot of token usage and call statistics for this MCP server session. Re-read at any time for the current totals.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(sessionUsage.snapshot(), null, 2),
        },
      ],
    }),
  );
}

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

interface RegisterToolsOptions {
  server: McpServer;
  tools: UnifiedTool[];
  executeTool: (
    name: string,
    args: BaseToolArguments,
    onProgress?: (output: string) => void,
    onUsage?: (stats: UsageStats) => void,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
  getPromptMessage: (name: string, args: Record<string, string>) => string;
  progressMessages: (op: string) => string[];
  sessionUsage?: SessionUsage;
}

export function registerTools({
  server,
  tools,
  executeTool,
  getPromptMessage,
  progressMessages,
  sessionUsage,
}: RegisterToolsOptions) {
  const seen = new Set<string>();
  for (const tool of tools) {
    // Fail fast: toolRegistry lookups take the first name match, so a silent
    // duplicate would shadow the later tool at execute time.
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name "${tool.name}" — tool names must be unique within a server`);
    }
    seen.add(tool.name);
    const shape = (tool.zodSchema as z.ZodObject<z.ZodRawShape>).shape;
    const outputShape = tool.outputSchema ? (tool.outputSchema as z.ZodObject<z.ZodRawShape>).shape : undefined;

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: shape,
        ...(outputShape ? { outputSchema: outputShape } : {}),
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>, extra: ToolExtra): Promise<CallToolResult> => {
        const toolName = tool.name;
        const handle = createProgressTracker(toolName, extra, progressMessages(toolName));

        try {
          const toolArgs = args as unknown as BaseToolArguments;
          Logger.toolInvocation(toolName, args);

          const result = await executeTool(
            toolName,
            toolArgs,
            (newOutput) => {
              handle.updateOutput(newOutput);
            },
            sessionUsage ? (stats) => sessionUsage.record(stats) : undefined,
            extra.signal,
          );

          await handle.stop(true);

          if (typeof result === "string") {
            return {
              content: [{ type: "text", text: result }],
              isError: false,
            };
          }
          return {
            content: [{ type: "text", text: result.text }],
            structuredContent: result.structuredContent,
            isError: false,
          };
        } catch (error) {
          await handle.stop(false);
          Logger.error(`Error in tool '${toolName}':`, error);

          const errorMessage = error instanceof Error ? error.message : String(error);

          return {
            content: [{ type: "text", text: `Error executing ${toolName}: ${errorMessage}` }],
            isError: true,
          };
        }
      },
    );
  }

  for (const tool of tools) {
    if (!tool.prompt) continue;

    server.registerPrompt(tool.name, { description: tool.prompt.description }, async (args: Record<string, string>) => {
      const promptMessage = getPromptMessage(tool.name, args);
      return {
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: promptMessage },
          },
        ],
      };
    });
  }
}
