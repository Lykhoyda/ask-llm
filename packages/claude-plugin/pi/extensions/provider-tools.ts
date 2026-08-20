import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { executeTool as executeAntigravityTool } from "@ask-llm/antigravity-mcp/register";
import { executeTool as executeCodexTool } from "@ask-llm/codex-mcp/register";
import { executeTool as executeGeminiTool } from "@ask-llm/gemini-mcp/register";
import { executeTool as executeGrokTool } from "@ask-llm/grok-mcp/register";
import { executeTool as executeOllamaTool } from "@ask-llm/ollama-mcp/register";
import { CURSOR_PROVIDERS, executeCursorAgent } from "@ask-llm/mcp/cursor";
import { Type } from "typebox";

const providerNames = ["codex", "gemini", "grok", "ollama", "antigravity"] as const;
type ProviderName = (typeof providerNames)[number];
const cursorProviderNames = CURSOR_PROVIDERS;

type CanonicalResult =
  | string
  | { text: string; structuredContent: Record<string, unknown> };
type CanonicalExecute = (
  toolName: string,
  args: Record<string, unknown>,
  onProgress?: (text: string) => void,
  onUsage?: (usage: unknown) => void,
  signal?: AbortSignal,
) => Promise<CanonicalResult>;

const executors: Record<ProviderName, { tool: string; execute: CanonicalExecute }> = {
  codex: { tool: "ask-codex", execute: executeCodexTool as CanonicalExecute },
  gemini: { tool: "ask-gemini", execute: executeGeminiTool as CanonicalExecute },
  grok: { tool: "ask-grok", execute: executeGrokTool as CanonicalExecute },
  ollama: { tool: "ask-ollama", execute: executeOllamaTool as CanonicalExecute },
  antigravity: { tool: "ask-antigravity", execute: executeAntigravityTool as CanonicalExecute },
};

const relativeDirs = Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), {
  maxItems: 32,
  description: "Relative directories the provider may read in addition to the current workspace.",
});
const prompt = Type.String({ minLength: 1, maxLength: 100000, description: "Prompt sent to the consulted provider." });

const codexSchema = Type.Object({
  prompt,
  model: Type.Optional(Type.String({ minLength: 1 })),
  reasoningEffort: Type.Optional(StringEnum(["low", "medium", "high", "xhigh", "max"] as const)),
  sessionId: Type.Optional(Type.String()),
  includeDirs: Type.Optional(relativeDirs),
  preferred: Type.Optional(Type.Boolean()),
  sandbox: Type.Optional(StringEnum(["read-only", "workspace-write"] as const)),
});
const geminiSchema = Type.Object({
  prompt,
  model: Type.Optional(Type.String({ minLength: 1 })),
  sessionId: Type.Optional(Type.String()),
});
const grokSchema = Type.Object({
  prompt,
  model: Type.Optional(Type.String({ minLength: 1 })),
  harness: Type.Optional(StringEnum(["xai-api", "grok-cli"] as const)),
  reasoningEffort: Type.Optional(StringEnum(["low", "medium", "high", "xhigh"] as const)),
});
const ollamaSchema = Type.Object({
  prompt,
  model: Type.Optional(Type.String({ minLength: 1 })),
  sessionId: Type.Optional(Type.String()),
});
const antigravitySchema = Type.Object({
  prompt,
  includeDirs: Type.Optional(relativeDirs),
});

const providerOptionSchemas = {
  codex: Type.Omit(codexSchema, ["prompt"]),
  gemini: Type.Omit(geminiSchema, ["prompt"]),
  grok: Type.Omit(grokSchema, ["prompt"]),
  ollama: Type.Omit(ollamaSchema, ["prompt"]),
  antigravity: Type.Omit(antigravitySchema, ["prompt"]),
};

const cursorAgentSchema = Type.Object({
  prompt,
  provider: StringEnum(cursorProviderNames, {
    description:
      "Canonical provider family of the Cursor model (claude, codex, gemini, grok); verified against the requested and CLI-reported model ID.",
  }),
  model: Type.String({
    minLength: 1,
    description:
      "Exact ID from agent --list-models; echoed back as `model`, with the CLI display label in `reportedModel`. Auto and other noncanonical IDs are refused.",
  }),
});

const askMultiSchema = Type.Object({
  prompt,
  providers: Type.Array(StringEnum(providerNames), {
    minItems: 2,
    maxItems: 5,
    description: "Two to five unique providers. Results preserve this input order.",
  }),
  options: Type.Optional(
    Type.Object({
      codex: Type.Optional(providerOptionSchemas.codex),
      gemini: Type.Optional(providerOptionSchemas.gemini),
      grok: Type.Optional(providerOptionSchemas.grok),
      ollama: Type.Optional(providerOptionSchemas.ollama),
      antigravity: Type.Optional(providerOptionSchemas.antigravity),
    }),
  ),
});

function bounded(text: string): { text: string; truncated: boolean } {
  const result = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!result.truncated) return { text: result.content, truncated: false };
  return {
    text: `${result.content}\n\n[Output truncated to ${DEFAULT_MAX_BYTES} bytes / ${DEFAULT_MAX_LINES} lines.]`,
    truncated: true,
  };
}

function boundedStructured(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const response = value.response;
  if (typeof response !== "string") return value;
  const limited = bounded(response);
  return limited.truncated ? { ...value, response: limited.text, outputTruncated: true } : value;
}

async function invokeProvider(
  provider: ProviderName,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onProgress?: (text: string) => void,
): Promise<{ text: string; details: Record<string, unknown> }> {
  let usage: unknown;
  const canonical = executors[provider];
  const result = await canonical.execute(canonical.tool, args, onProgress, (next) => {
    usage = next;
  }, signal);
  const rawText = typeof result === "string" ? result : result.text;
  const output = bounded(rawText);
  return {
    text: output.text,
    details: {
      provider,
      structuredContent: boundedStructured(typeof result === "string" ? undefined : result.structuredContent),
      askLlmUsage: usage,
      outputTruncated: output.truncated,
    },
  };
}

type ProgressUpdate = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

function progressForwarder(onUpdate: ((result: ProgressUpdate) => void) | undefined, provider: string) {
  return onUpdate
    ? (text: string) => {
        const output = bounded(text);
        onUpdate({ content: [{ type: "text", text: `[${provider}] ${output.text}` }], details: { provider } });
      }
    : undefined;
}

function registerProviderTool<T extends ReturnType<typeof Type.Object>>(
  pi: ExtensionAPI,
  definition: {
    name: string;
    label: string;
    description: string;
    parameters: T;
    provider: ProviderName;
  },
): void {
  pi.registerTool({
    ...definition,
    async execute(_toolCallId, params, signal, onUpdate) {
      const result = await invokeProvider(
        definition.provider,
        params as Record<string, unknown>,
        signal,
        progressForwarder(onUpdate, definition.provider),
      );
      return { content: [{ type: "text", text: result.text }], details: result.details };
    },
  });
}

export function registerProviderTools(pi: ExtensionAPI): void {
  registerProviderTool(pi, {
    name: "ask-codex",
    label: "Ask Codex",
    description:
      "Consult OpenAI Codex through Ask LLM's canonical executor. Read-only by default; use workspace-write only for an explicit write flow such as codex-image. Output is bounded to Pi's 50KB/2000-line limits.",
    parameters: codexSchema,
    provider: "codex",
  });
  registerProviderTool(pi, {
    name: "ask-gemini",
    label: "Ask Gemini",
    description:
      "Consult Gemini through Ask LLM's canonical executor, including its quota fallback, validation, sessions, and structured response. Output is bounded to Pi's 50KB/2000-line limits.",
    parameters: geminiSchema,
    provider: "gemini",
  });
  registerProviderTool(pi, {
    name: "ask-grok",
    label: "Ask Grok",
    description:
      "Consult Grok through Ask LLM's canonical xAI API executor. Requires XAI_API_KEY and may incur metered API charges; no billing changes or model fallback are performed. Output is bounded to Pi's 50KB/2000-line limits.",
    parameters: grokSchema,
    provider: "grok",
  });
  registerProviderTool(pi, {
    name: "ask-ollama",
    label: "Ask Ollama",
    description:
      "Consult the configured local Ollama model through Ask LLM's canonical executor. No external provider data transfer; output is bounded to Pi's 50KB/2000-line limits.",
    parameters: ollamaSchema,
    provider: "ollama",
  });
  registerProviderTool(pi, {
    name: "ask-antigravity",
    label: "Ask Antigravity",
    description:
      "Consult Google's Antigravity CLI (agy) through Ask LLM's canonical executor. Requires a supported authenticated agy installation. Output is bounded to Pi's 50KB/2000-line limits.",
    parameters: antigravitySchema,
    provider: "antigravity",
  });

  pi.registerTool({
    name: "ask-cursor-agent",
    label: "Ask via Cursor Agent",
    description:
      "Use Cursor Agent as a model-neutral read-only harness. Provider (claude, codex, gemini, grok) and exact model ID are separate and must agree; Auto or noncanonical catalog IDs are refused. Prompts above 16KB are piped over stdin. Requires an authenticated Cursor CLI and may consume included usage or on-demand spend; no spend settings or fallback are changed.",
    parameters: cursorAgentSchema,
    async execute(_toolCallId, params, signal, onUpdate) {
      const result = await executeCursorAgent({
        prompt: params.prompt,
        provider: params.provider,
        model: params.model,
        signal,
        onProgress: progressForwarder(onUpdate, params.provider),
      });
      const text = bounded(result.response);
      return {
        content: [{ type: "text", text: text.text }],
        details: {
          provider: result.provider,
          harness: result.harness,
          model: result.model,
          reportedModel: result.reportedModel,
          askLlmUsage: result.usage,
          outputTruncated: text.truncated,
        },
      };
    },
  });

  pi.registerTool({
    name: "ask-multi",
    label: "Ask Multiple Providers",
    description:
      "Send exactly the same prompt to two to five Ask LLM providers concurrently. Dispatch is deterministic and bounded; results preserve provider input order and report every failure instead of silently dropping it.",
    parameters: askMultiSchema,
    async execute(_toolCallId, params, signal, onUpdate) {
      const unique = [...new Set(params.providers)];
      if (unique.length !== params.providers.length) {
        throw new Error("ask-multi providers must be unique");
      }
      const settled = await Promise.allSettled(
        params.providers.map((provider) =>
          invokeProvider(
            provider,
            { prompt: params.prompt, ...(params.options?.[provider] ?? {}) },
            signal,
            progressForwarder(onUpdate, provider),
          ),
        ),
      );
      const records = settled.map((entry, index) => {
        const provider = params.providers[index];
        if (entry.status === "fulfilled") {
          return { provider, status: "fulfilled" as const, ...entry.value };
        }
        const error = entry.reason instanceof Error ? entry.reason.message : String(entry.reason);
        return { provider, status: "rejected" as const, error };
      });
      const text = records
        .map((record) =>
          record.status === "fulfilled"
            ? `## ${record.provider}\n\n${record.text}`
            : `## ${record.provider}\n\nERROR: ${record.error}`,
        )
        .join("\n\n---\n\n");
      const output = bounded(text);
      return {
        content: [{ type: "text", text: output.text }],
        details: { providers: params.providers, results: records, outputTruncated: output.truncated },
      };
    },
  });
}
