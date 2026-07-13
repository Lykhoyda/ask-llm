import { createRequire } from "node:module";
import {
  type AskResponse,
  askResponseSchema,
  createDiagnoseTool,
  createProgressTracker,
  createSessionUsage,
  createUsageStatsTool,
  Logger,
  type ProviderName,
  registerSessionUsageResource,
  type UsageStats,
} from "@ask-llm/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getEligibleProviderKeys, INSTALL_HINTS, PROVIDERS } from "./constants.js";
import { buildMultiLlmInputSchema, dispatchMultiLlm, formatMultiLlmReport, multiLlmReportSchema } from "./multiLlm.js";
import { isCommandAvailable } from "./utils/availability.js";
import { buildProviderSpecs } from "./utils/providerSpecs.js";

function readPackageJson(): { name: string; version: string } {
  try {
    const require = createRequire(import.meta.url);
    return require("../package.json") as { name: string; version: string };
  } catch {
    return { name: "@ask-llm/mcp", version: "0.0.0" };
  }
}

export interface ProviderStatus {
  available: string[];
  missing: string[];
}

export type ExecutorFn = (options: {
  prompt: string;
  model?: string;
  sessionId?: string;
  includeDirs?: string[];
  sandbox?: "read-only" | "workspace-write";
  outputSchema?: Record<string, unknown>;
  readOnly?: boolean;
  onProgress?: (output: string) => void;
}) => Promise<{
  response: string;
  // Actual model that produced the answer. Gemini/Codex report it via
  // usage.model; Ollama and Antigravity surface it here (their usage may be
  // undefined), so the unified layer reads result.model to stay accurate after
  // a provider-internal fallback (e.g. Antigravity Pro → Flash).
  model?: string;
  usage?: UsageStats;
  sessionId?: string;
  threadId?: string;
  transcriptPath?: string;
}>;

export type {
  MachineDeps,
  MachineJsonSchemaBundle,
  MachineSchemaRefinement,
  MachineSchemaRefinementSet,
  MachineSchemaRefinementViolation,
  MachineSchemaTarget,
} from "./machine.js";
export {
  buildRolePrompt,
  machineJsonSchemaBundle,
  runMachineRequest,
  validateMachineSchemaRefinements,
} from "./machine.js";

const loadedExecutors = new Map<string, ExecutorFn>();

export function getLoadedExecutor(name: string): ExecutorFn | undefined {
  return loadedExecutors.get(name);
}

export async function detectProviders(): Promise<ProviderStatus> {
  const available: string[] = [];
  const missing: string[] = [];

  const checks = await Promise.all(
    Object.entries(PROVIDERS).map(async ([key, provider]) => {
      let found: boolean;
      const disabled = Boolean(provider.disabledWhenEnvVar && process.env[provider.disabledWhenEnvVar]);
      if (disabled) {
        found = false;
      } else if (provider.availabilityModule && provider.availabilityFn) {
        try {
          const mod = await import(provider.availabilityModule);
          found = await (mod[provider.availabilityFn] as () => Promise<boolean>)();
        } catch {
          found = false;
        }
      } else {
        found = await isCommandAvailable(provider.command);
      }
      return { key, provider, found, disabled };
    }),
  );

  for (const { key, provider, found, disabled } of checks) {
    if (found) {
      try {
        const mod = await import(provider.executorModule);
        loadedExecutors.set(key, mod[provider.executorFn] as ExecutorFn);
        available.push(key);
        Logger.warn(`Provider ${provider.name} (${provider.command}) — available`);
      } catch (err) {
        missing.push(key);
        Logger.error(`Provider ${provider.name} — import failed:`, err);
      }
    } else {
      missing.push(key);
      if (disabled) {
        Logger.warn(
          `Provider ${provider.name} (${provider.command}) — disabled because ${provider.disabledWhenEnvVar} identifies the current MCP host`,
        );
        continue;
      }
      const hint = INSTALL_HINTS[key] ?? "";
      Logger.warn(`Provider ${provider.name} (${provider.command}) — not found${hint ? `. Install: ${hint}` : ""}`);
    }
  }

  if (available.length === 0) {
    Logger.warn("No LLM providers found. Install at least one CLI to enable AI tools.");
    for (const [key, hint] of Object.entries(INSTALL_HINTS)) {
      Logger.warn(`  ${PROVIDERS[key]?.name ?? key}: ${hint}`);
    }
  }

  return { available, missing };
}

function buildAskLlmSchema(availableProviders: string[]) {
  const providerEnum = availableProviders.length > 0 ? availableProviders : getEligibleProviderKeys();
  const providerDescriptions = providerEnum
    .map((k) => {
      const p = PROVIDERS[k];
      return p ? `"${k}" (${p.name}, default model: ${p.defaultModel})` : k;
    })
    .join(", ");

  return z.object({
    provider: z
      .enum(providerEnum as [string, ...string[]])
      .describe(`Which LLM provider to use. Available: ${providerDescriptions}`),
    prompt: z.string().min(1).max(100000).describe("The question, code review request, or analysis task to send"),
    model: z.string().optional().describe("Override the default model. Usually not needed."),
    sessionId: z
      .string()
      .optional()
      .describe(
        "Optional session ID to resume a prior conversation. Pass the [Session ID: ...] or [Thread ID: ...] value from a previous response. Each provider handles sessions natively (Claude/Gemini --resume, Codex exec resume) or via server-side replay (Ollama).",
      ),
  });
}

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const PROGRESS_MESSAGES = (op: string) => [
  `${op} - Processing your request...`,
  `${op} - Generating insights...`,
  `${op} - Large analysis in progress...`,
  `${op} - Still working...`,
];

export async function startServer() {
  Logger.debug("init @ask-llm/mcp");
  Logger.checkNodeVersion();
  const { name, version } = readPackageJson();
  const { available } = await detectProviders();

  const server = new McpServer({ name, version });
  const sessionUsage = createSessionUsage();

  const askLlmSchema = buildAskLlmSchema(available);

  server.registerTool(
    "ask-llm",
    {
      description:
        "Send a prompt to an LLM provider (Codex, Claude, Antigravity, Ollama, Gemini). Specify which provider to use. Each provider auto-selects its best model with fallback on errors. Returns both human-readable text and a structured response (provider, model, sessionId, usage) via outputSchema.",
      inputSchema: askLlmSchema.shape,
      outputSchema: (askResponseSchema as z.ZodObject<z.ZodRawShape>).shape,
      annotations: { title: "Ask LLM", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args: Record<string, unknown>, extra: ToolExtra): Promise<CallToolResult> => {
      const progress = createProgressTracker("ask-llm", extra, PROGRESS_MESSAGES("ask-llm"));
      try {
        const { provider, prompt, model, sessionId } = askLlmSchema.parse(args);
        Logger.toolInvocation("ask-llm", args);

        const executor = loadedExecutors.get(provider);
        if (!executor) {
          const hint = INSTALL_HINTS[provider] ?? "";
          throw new Error(
            `Provider "${provider}" is not available. ${hint ? `Install: ${hint}` : "Check that the CLI is on your PATH."}`,
          );
        }

        const result = await executor({
          prompt,
          model,
          sessionId,
          onProgress: (output) => {
            progress.updateOutput(output);
          },
        });

        if (result.usage) sessionUsage.record(result.usage);

        await progress.stop(true);
        const providerName = PROVIDERS[provider]?.name ?? provider;
        const resolvedSessionId = result.sessionId ?? result.threadId;
        const idLine = result.sessionId
          ? `\n\n[Session ID: ${result.sessionId}]`
          : result.threadId
            ? `\n\n[Thread ID: ${result.threadId}]`
            : "";
        const structured: AskResponse = {
          provider: provider as ProviderName,
          response: result.response,
          model: result.usage?.model ?? result.model ?? model ?? PROVIDERS[provider]?.defaultModel ?? "unknown",
          sessionId: resolvedSessionId,
          usage: result.usage,
        };
        return {
          content: [{ type: "text", text: `${providerName} response:\n${result.response}${idLine}` }],
          structuredContent: structured as unknown as Record<string, unknown>,
          isError: false,
        };
      } catch (error) {
        await progress.stop(false);
        const msg = error instanceof Error ? error.message : String(error);
        Logger.error("ask-llm error:", error);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    },
  );

  const pingSchema = z.object({
    message: z.string().optional().describe("A message to echo back to test the connection"),
  });

  server.registerTool(
    "ping",
    {
      description: "Test connectivity with the MCP server",
      inputSchema: pingSchema.shape,
      annotations: { title: "Ping", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const { message } = pingSchema.parse(args);
      const providers = available.length > 0 ? available.join(", ") : "none";
      const text = message || `Pong from @ask-llm/mcp! Available providers: ${providers}`;
      return { content: [{ type: "text", text }], isError: false };
    },
  );

  const usageTool = createUsageStatsTool(sessionUsage);
  const usageOutputShape = usageTool.outputSchema
    ? (usageTool.outputSchema as z.ZodObject<z.ZodRawShape>).shape
    : undefined;
  server.registerTool(
    usageTool.name,
    {
      description: usageTool.description,
      inputSchema: {},
      ...(usageOutputShape ? { outputSchema: usageOutputShape } : {}),
      annotations: usageTool.annotations,
    },
    async (): Promise<CallToolResult> => {
      const result = await usageTool.execute({});
      if (typeof result === "string") {
        return { content: [{ type: "text", text: result }], isError: false };
      }
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: result.structuredContent,
        isError: false,
      };
    },
  );
  registerSessionUsageResource(server, sessionUsage);

  const multiLlmInputSchema = buildMultiLlmInputSchema(available.length > 0 ? available : getEligibleProviderKeys());
  server.registerTool(
    "multi-llm",
    {
      description:
        "Dispatch the same prompt to multiple LLM providers in parallel and return all responses in one structured payload. Use when you want to compare answers across Codex, Claude, Antigravity, Ollama, and Gemini, or when you want a multi-provider sanity check on a question. Returns per-provider success/failure, response text, model, sessionId, and token usage. Each call is fresh — no session continuity (use ask-llm for individual session-bearing calls).",
      inputSchema: multiLlmInputSchema.shape,
      outputSchema: (multiLlmReportSchema as z.ZodObject<z.ZodRawShape>).shape,
      annotations: {
        title: "Multi-LLM Parallel Dispatch",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const { prompt, providers: requestedProviders } = multiLlmInputSchema.parse(args) as {
        prompt: string;
        providers?: string[];
      };
      const providers = requestedProviders && requestedProviders.length > 0 ? requestedProviders : available;
      Logger.toolInvocation("multi-llm", { prompt: prompt.slice(0, 80), providers });

      const report = await dispatchMultiLlm({
        prompt,
        providers,
        getExecutor: (name) => loadedExecutors.get(name),
        recordUsage: (stats) => sessionUsage.record(stats),
      });

      return {
        content: [{ type: "text", text: formatMultiLlmReport(report) }],
        structuredContent: report as unknown as Record<string, unknown>,
        isError: false,
      };
    },
  );

  const diagnoseSpecs = await buildProviderSpecs();
  const diagnoseTool = createDiagnoseTool(diagnoseSpecs);
  const diagnoseOutputShape = diagnoseTool.outputSchema
    ? (diagnoseTool.outputSchema as z.ZodObject<z.ZodRawShape>).shape
    : undefined;
  server.registerTool(
    diagnoseTool.name,
    {
      description: diagnoseTool.description,
      inputSchema: {},
      ...(diagnoseOutputShape ? { outputSchema: diagnoseOutputShape } : {}),
      annotations: diagnoseTool.annotations,
    },
    async (): Promise<CallToolResult> => {
      const result = await diagnoseTool.execute({});
      if (typeof result === "string") {
        return { content: [{ type: "text", text: result }], isError: false };
      }
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: result.structuredContent,
        isError: false,
      };
    },
  );

  Logger.warn(`@ask-llm/mcp v${version} — 5 tools, ${available.length} provider(s): ${available.join(", ") || "none"}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.debug("@ask-llm/mcp listening on stdio");
}
