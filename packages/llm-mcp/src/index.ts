import { createRequire } from "node:module";
import {
  type AskResponse,
  askResponseSchema,
  PROVIDERS as CANONICAL_PROVIDERS,
  CURSOR_PROVIDERS,
  createDiagnoseTool,
  createProgressTracker,
  createSessionUsage,
  createUsageStatsTool,
  Logger,
  type ProviderName,
  registerSessionUsageResource,
  relativeDirSchema,
  type UsageStats,
} from "@ask-llm/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getEligibleProviderKeys, INSTALL_HINTS, PROVIDERS } from "./constants.js";
import { executeCursorAgent } from "./cursorAgent.js";
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
  unavailable: ProviderUnavailableStatus[];
}

export type ProviderUnavailableState = "missing" | "unsupported" | "unusable" | "disabled" | "import-failed";

export interface ProviderUnavailableStatus {
  key: string;
  provider: string;
  state: ProviderUnavailableState;
  detected: boolean;
  version?: string;
  requiredVersion?: string;
  message: string;
  remediation?: string;
}

interface ProviderSupportProbe {
  status: "supported" | "unsupported" | "unusable" | "missing";
  available: boolean;
  detected: boolean;
  version?: string;
  requiredVersion: string;
  message: string;
  remediation?: string;
}

export type ExecutorFn = (options: {
  prompt: string;
  model?: string;
  sessionId?: string;
  includeDirs?: string[];
  sandbox?: "read-only" | "workspace-write";
  outputSchema?: Record<string, unknown>;
  readOnly?: boolean;
  harness?: "xai-api" | "grok-cli";
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  onProgress?: (output: string) => void;
  signal?: AbortSignal;
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
  provider?: ProviderName;
  harness?: "xai-api" | "grok-cli" | "cursor-agent";
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

function parseProviderName(value: string): ProviderName {
  const match = CANONICAL_PROVIDERS.find((provider) => provider === value);
  if (!match) throw new Error(`Unknown provider "${value}"`);
  return match;
}

const loadedExecutors = new Map<string, ExecutorFn>();

export function getLoadedExecutor(name: string): ExecutorFn | undefined {
  return loadedExecutors.get(name);
}

export async function detectProviders(): Promise<ProviderStatus> {
  const available: string[] = [];
  const missing: string[] = [];
  const unavailable: ProviderUnavailableStatus[] = [];

  const checks = await Promise.all(
    Object.entries(PROVIDERS).map(async ([key, provider]) => {
      let found: boolean;
      let support: ProviderSupportProbe | undefined;
      let probeError: string | undefined;
      const disabled = Boolean(provider.disabledWhenEnvVar && process.env[provider.disabledWhenEnvVar]);
      if (disabled) {
        found = false;
      } else if (provider.supportProbeModule && provider.supportProbeFn) {
        try {
          const mod = (await import(provider.supportProbeModule)) as Record<string, unknown>;
          const fn = mod[provider.supportProbeFn] as (() => Promise<ProviderSupportProbe>) | undefined;
          if (typeof fn !== "function") throw new Error("support probe is unavailable");
          support = await fn();
          found = support.available;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          support = {
            status: "unusable",
            available: false,
            detected: true,
            requiredVersion: "unknown",
            message: `${provider.name} was detected, but its support probe failed: ${detail}`,
            remediation: INSTALL_HINTS[key],
          };
          found = false;
        }
      } else if (provider.availabilityModule && provider.availabilityFn) {
        try {
          const mod = await import(provider.availabilityModule);
          found = await (mod[provider.availabilityFn] as () => Promise<boolean>)();
        } catch (error) {
          found = false;
          probeError = error instanceof Error ? error.message : String(error);
        }
      } else {
        found = await isCommandAvailable(provider.command);
      }
      return { key, provider, found, disabled, support, probeError };
    }),
  );

  for (const { key, provider, found, disabled, support, probeError } of checks) {
    loadedExecutors.delete(key);
    if (found) {
      try {
        const mod = await import(provider.executorModule);
        loadedExecutors.set(key, mod[provider.executorFn] as ExecutorFn);
        available.push(key);
        Logger.warn(`Provider ${provider.name} (${provider.command}) — available`);
      } catch (err) {
        unavailable.push({
          key,
          provider: provider.name,
          state: "import-failed",
          detected: true,
          message: `${provider.name} was detected, but its executor could not be loaded.`,
          remediation: INSTALL_HINTS[key],
        });
        Logger.error(`Provider ${provider.name} — import failed:`, err);
      }
    } else {
      if (disabled) {
        unavailable.push({
          key,
          provider: provider.name,
          state: "disabled",
          detected: true,
          message: `${provider.name} is disabled because ${provider.disabledWhenEnvVar} identifies the current MCP host.`,
        });
        Logger.warn(
          `Provider ${provider.name} (${provider.command}) — disabled because ${provider.disabledWhenEnvVar} identifies the current MCP host`,
        );
        continue;
      }
      if (support) {
        const state = support.status === "supported" ? "unusable" : support.status;
        if (state === "missing") missing.push(key);
        unavailable.push({
          key,
          provider: provider.name,
          state,
          detected: support.detected,
          version: support.version,
          requiredVersion: support.requiredVersion,
          message: support.message,
          remediation: support.remediation,
        });
        Logger.warn(
          `Provider ${provider.name} (${provider.command}) — ${[support.message, support.remediation].filter(Boolean).join(" ")}`,
        );
        continue;
      }
      const hint = INSTALL_HINTS[key] ?? "";
      const failure = provider.availabilityFailure ?? `${provider.name} (${provider.command}) was not found on PATH.`;
      const message = probeError ? `${failure} (readiness probe failed: ${probeError})` : failure;
      missing.push(key);
      unavailable.push({
        key,
        provider: provider.name,
        state: "missing",
        detected: false,
        message,
        remediation: hint || undefined,
      });
      Logger.warn(`Provider ${provider.name} (${provider.command}) — ${message}${hint ? `. Configure: ${hint}` : ""}`);
    }
  }

  if (available.length === 0) {
    Logger.warn("No LLM providers found. Configure at least one API, CLI, or local endpoint to enable AI tools.");
    for (const [key, hint] of Object.entries(INSTALL_HINTS)) {
      Logger.warn(`  ${PROVIDERS[key]?.name ?? key}: ${hint}`);
    }
  }

  return { available, missing, unavailable };
}

export function buildAskLlmSchema(availableProviders: string[], excludedProviders: string[] = []) {
  const excluded = new Set(excludedProviders);
  const providerEnum =
    availableProviders.length > 0
      ? availableProviders
      : getEligibleProviderKeys().filter((provider) => !excluded.has(provider));
  const providerDescriptions = providerEnum
    .map((k) => {
      const p = PROVIDERS[k];
      return p ? `"${k}" (${p.name}, default model: ${p.defaultModel})` : k;
    })
    .join(", ");

  return z
    .object({
      provider: z
        .enum(providerEnum as [string, ...string[]])
        .describe(`Which LLM provider to use. Available: ${providerDescriptions}`),
      prompt: z.string().min(1).max(100000).describe("The question, code review request, or analysis task to send"),
      model: z.string().optional().describe("Exact model ID for the selected provider/harness. Usually not needed."),
      harness: z
        .enum(["provider-default", "xai-api", "grok-cli"])
        .optional()
        .describe(
          "Execution harness, separate from provider/model. xai-api and grok-cli require provider=grok. Use ask-cursor-agent for Cursor's model-neutral harness. No harness fallback is attempted.",
        ),
      sessionId: z
        .string()
        .optional()
        .describe(
          'Optional session ID. For Codex, pass "" on the first call to create a persisted thread, then pass its returned Thread ID to resume; omitting it makes the call ephemeral. For other session-capable providers, pass a prior Session ID to resume. Claude/Gemini use --resume, Codex uses exec resume, and Ollama uses server-side replay. Grok and Antigravity are one-shot.',
        ),
      includeDirs: z
        .array(relativeDirSchema)
        .max(32)
        .optional()
        .describe(
          'Relative workspace directories exposed to providers that support additional read roots (Codex, Claude, and Antigravity). Unsupported providers are rejected instead of silently dropping this option; Codex only accepts it on a fresh call (sessionId omitted or ""), never on a resumed thread.',
        ),
      reasoningEffort: z
        .enum(["low", "medium", "high", "xhigh", "max"])
        .optional()
        .describe(
          "Provider-native reasoning effort. Codex accepts low/medium/high/xhigh/max; Grok accepts low/medium/high/xhigh. Unsupported provider/effort combinations are rejected, never stripped.",
        ),
    })
    .superRefine((value, ctx) => {
      if ((value.harness === "xai-api" || value.harness === "grok-cli") && value.provider !== "grok") {
        ctx.addIssue({
          code: "custom",
          path: ["harness"],
          message: `${value.harness} is only valid with provider=grok`,
        });
      }
      if (value.includeDirs && !["codex", "claude", "antigravity"].includes(value.provider)) {
        ctx.addIssue({
          code: "custom",
          path: ["includeDirs"],
          message: `includeDirs is not supported by provider=${value.provider}; Ask LLM will not silently strip it`,
        });
      }
      if (value.provider === "codex" && value.includeDirs && value.sessionId) {
        ctx.addIssue({
          code: "custom",
          path: ["includeDirs"],
          message:
            'includeDirs cannot be added to a resumed Codex session because `codex exec resume` has no --add-dir; establish directories on the first call with sessionId "" and omit includeDirs when resuming',
        });
      }
      if (value.reasoningEffort && value.provider !== "codex" && value.provider !== "grok") {
        ctx.addIssue({
          code: "custom",
          path: ["reasoningEffort"],
          message: `reasoningEffort is not supported by provider=${value.provider}; Ask LLM will not silently strip it`,
        });
      }
      if (value.provider === "grok" && value.reasoningEffort === "max") {
        ctx.addIssue({
          code: "custom",
          path: ["reasoningEffort"],
          message: "Grok reasoningEffort must be low, medium, high, or xhigh",
        });
      }
    });
}

export function formatProviderPing(status: ProviderStatus, message?: string): string {
  const prefix = message || "Pong from @ask-llm/mcp!";
  const providers = status.available.length > 0 ? status.available.join(", ") : "none";
  const detectedIssues = status.unavailable
    .filter((provider) => provider.detected && ["unsupported", "unusable"].includes(provider.state))
    .map((provider) => [provider.message, provider.remediation].filter(Boolean).join(" "));
  return [`${prefix} Available providers: ${providers}.`, ...detectedIssues].join(" ");
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
  const providerStatus = await detectProviders();
  const { available } = providerStatus;
  const excludedProviders = providerStatus.unavailable
    .filter((provider) => provider.state === "unsupported" || provider.state === "unusable")
    .map((provider) => provider.key);

  const server = new McpServer({ name, version });
  const sessionUsage = createSessionUsage();

  const askLlmSchema = buildAskLlmSchema(available, excludedProviders);

  server.registerTool(
    "ask-llm",
    {
      description:
        "Send a prompt to an LLM provider (Codex, Claude, Grok, Antigravity, Ollama, Gemini). Specify which provider to use. Provider-specific fallback behavior is reported truthfully; Grok never substitutes or falls back from the requested model. Returns both human-readable text and a structured response (provider, model, sessionId, usage) via outputSchema.",
      inputSchema: askLlmSchema.shape,
      outputSchema: askResponseSchema.shape,
      annotations: { title: "Ask LLM", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args: Record<string, unknown>, extra: ToolExtra): Promise<CallToolResult> => {
      const progress = createProgressTracker("ask-llm", extra, PROGRESS_MESSAGES("ask-llm"));
      try {
        const { provider, prompt, model, sessionId, harness, includeDirs, reasoningEffort } = askLlmSchema.parse(args);
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
          includeDirs,
          reasoningEffort,
          harness: harness === "xai-api" || harness === "grok-cli" ? harness : undefined,
          onProgress: (output) => {
            progress.updateOutput(output);
          },
          signal: extra.signal,
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
          provider: result.provider ?? parseProviderName(provider),
          response: result.response,
          model: result.usage?.model ?? result.model ?? model ?? PROVIDERS[provider]?.defaultModel ?? "unknown",
          sessionId: resolvedSessionId,
          usage: result.usage,
          harness: result.harness,
        };
        const structuredContent: Record<string, unknown> = { ...structured };
        return {
          content: [{ type: "text", text: `${providerName} response:\n${result.response}${idLine}` }],
          structuredContent,
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

  const cursorAgentSchema = z.object({
    provider: z
      .enum(CURSOR_PROVIDERS)
      .describe(
        "Canonical provider family of the selected Cursor model (claude, codex, gemini, grok); kept separate from the cursor-agent harness and verified against the requested and CLI-reported model ID.",
      ),
    model: z
      .string()
      .min(1)
      .describe(
        "Exact Cursor catalog model ID from `agent --list-models`; Ask LLM does not rewrite it, echoes it back as `model`, and refuses Auto or other noncanonical IDs. The CLI's display label is returned separately as `reportedModel`.",
      ),
    prompt: z.string().min(1).max(100000).describe("Question, review, or analysis task for Cursor Agent ask mode."),
    includeDirs: z
      .array(relativeDirSchema)
      .max(32)
      .optional()
      .describe("Relative additional workspace directories passed to Cursor Agent with repeatable --add-dir."),
    sessionId: z
      .string()
      .optional()
      .describe("Prior Cursor conversation ID to resume. Omit on the first call and reuse the returned sessionId."),
  });
  server.registerTool(
    "ask-cursor-agent",
    {
      description:
        "Use Cursor Agent as a model-neutral, read-only consultation harness. The provider and exact Cursor catalog model ID are separate required fields. Runs `agent --print --mode ask` without --force/--trust, never changes spend settings, and never falls back to another model or provider.",
      inputSchema: cursorAgentSchema.shape,
      outputSchema: askResponseSchema.shape,
      annotations: {
        title: "Ask via Cursor Agent",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args: Record<string, unknown>, extra: ToolExtra): Promise<CallToolResult> => {
      const progress = createProgressTracker("ask-cursor-agent", extra, PROGRESS_MESSAGES("ask-cursor-agent"));
      try {
        const input = cursorAgentSchema.parse(args);
        const result = await executeCursorAgent({
          ...input,
          onProgress: (output) => progress.updateOutput(output),
          signal: extra.signal,
        });
        sessionUsage.record(result.usage);
        await progress.stop(true);
        const structured: AskResponse = {
          provider: result.provider,
          response: result.response,
          model: result.model,
          sessionId: result.sessionId,
          usage: result.usage,
          harness: result.harness,
          reportedModel: result.reportedModel,
        };
        const structuredContent: Record<string, unknown> = { ...structured };
        return {
          content: [
            {
              type: "text",
              text: `${result.provider} via Cursor Agent:\n${result.response}${result.sessionId ? `\n\n[Session ID: ${result.sessionId}]` : ""}`,
            },
          ],
          structuredContent,
          isError: false,
        };
      } catch (error) {
        await progress.stop(false);
        const message = error instanceof Error ? error.message : String(error);
        Logger.error("ask-cursor-agent error:", error);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
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
      const text = formatProviderPing(providerStatus, message);
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

  const multiLlmInputSchema = buildMultiLlmInputSchema(available, excludedProviders);
  server.registerTool(
    "multi-llm",
    {
      description:
        "Dispatch the same prompt to multiple LLM providers in parallel and return all responses in one structured payload. Use when you want to compare answers across Codex, Claude, Grok, Antigravity, Ollama, and Gemini, or when you want a multi-provider sanity check on a question. Returns per-provider success/failure, response text, model, sessionId, and token usage. Each call is fresh — no session continuity (use ask-llm for individual session-bearing calls).",
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
    async (args: Record<string, unknown>, extra: ToolExtra): Promise<CallToolResult> => {
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
        signal: extra.signal,
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

  Logger.warn(`@ask-llm/mcp v${version} — 6 tools, ${available.length} provider(s): ${available.join(", ") || "none"}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.debug("@ask-llm/mcp listening on stdio");
}
