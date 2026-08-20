import { EXECUTION, executeCommand, formatUsageStats, resolveTimeoutMs, type UsageStats } from "@ask-llm/shared";
import {
  ERROR_MESSAGES,
  FACTORY_DEFAULT_REASONING_EFFORT,
  GROK_CLI_FACTORY_DEFAULT_MODEL,
  type GrokReasoningEffort,
  REASONING_EFFORTS,
} from "../constants.js";

interface GrokCliEnvelope {
  model?: string;
  response?: string;
  result?: string;
  content?: string;
  message?: string | { content?: string };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
    reasoning_tokens?: number;
    total_tokens?: number;
  };
}

export interface GrokCliExecutorOptions {
  prompt: string;
  model?: string;
  reasoningEffort?: GrokReasoningEffort;
  onProgress?: (newOutput: string) => void;
  signal?: AbortSignal;
}

export interface GrokCliExecutorResult {
  response: string;
  model: string;
  sessionId: undefined;
  usage: UsageStats;
  harness: "grok-cli";
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

function redactCliSecrets(message: string): string {
  let result = message;
  for (const secret of [process.env.XAI_API_KEY, process.env.GROK_API_KEY].filter(isPresent)) {
    result = result.replaceAll(secret, "[REDACTED]");
  }
  return result.slice(0, EXECUTION.ERROR_TRUNCATE_LENGTH);
}

function isReasoningEffort(value: string): value is GrokReasoningEffort {
  return REASONING_EFFORTS.some((effort) => effort === value);
}

function effort(value?: GrokReasoningEffort): GrokReasoningEffort {
  const configured = value ?? process.env.ASK_GROK_REASONING_EFFORT ?? FACTORY_DEFAULT_REASONING_EFFORT;
  if (isReasoningEffort(configured)) return configured;
  throw new Error(`Unsupported Grok reasoning effort "${configured}". Use one of: ${REASONING_EFFORTS.join(", ")}.`);
}

function parseEnvelope(raw: string): GrokCliEnvelope {
  const candidates = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  for (const candidate of candidates) {
    try {
      const parsed: GrokCliEnvelope = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Keep looking for the final JSON object after non-protocol notices.
    }
  }
  try {
    const envelope: GrokCliEnvelope = JSON.parse(raw);
    return envelope;
  } catch {
    throw new Error("Grok CLI returned malformed JSON output. Update Grok Build and retry; no fallback was attempted.");
  }
}

function responseText(envelope: GrokCliEnvelope): string {
  const nested = typeof envelope.message === "object" ? envelope.message.content : undefined;
  const value = envelope.response ?? envelope.result ?? envelope.content ?? nested ?? envelope.message;
  return typeof value === "string" ? value.trimEnd() : "";
}

function classifyCliError(error: unknown, model: string): Error {
  const detail = redactCliSecrets(error instanceof Error ? error.message : String(error));
  const lower = detail.toLowerCase();
  if (
    lower.includes("enoent") ||
    (lower.includes("not found") && (lower.includes("grok") || lower.includes("command")))
  ) {
    return new Error(
      "Grok CLI harness is unavailable. Install Grok Build from https://x.ai/cli/install.sh and verify headless JSON support with `grok --help`. No fallback was attempted.",
    );
  }
  if (["unauthorized", "authentication", "login", "api key", "401", "403"].some((part) => lower.includes(part))) {
    return new Error(
      "Grok CLI authentication failed. Run `grok login` or configure XAI_API_KEY for headless use. Credentials were not logged or returned. No fallback was attempted.",
    );
  }
  if (["unknown model", "invalid model", "model not found", "unsupported model"].some((part) => lower.includes(part))) {
    return new Error(
      `Grok CLI model "${model}" is unavailable. Run \`grok models\` and pass an exact listed ID. No fallback was attempted.`,
    );
  }
  if (["rate limit", "quota", "usage limit", "credit", "429", "capacity"].some((part) => lower.includes(part))) {
    return new Error(`${ERROR_MESSAGES.RATE_LIMITED} Harness: Grok CLI.`);
  }
  if (["safety", "policy", "refus"].some((part) => lower.includes(part))) {
    return new Error(`${ERROR_MESSAGES.SAFETY_REFUSAL} Harness: Grok CLI.`);
  }
  return new Error(`Grok CLI harness failed: ${detail}. No fallback was attempted.`);
}

export async function probeGrokCli(): Promise<boolean> {
  try {
    const help = await executeCommand("grok", ["--help"], undefined, undefined, undefined, 5000);
    return help.includes("--output-format") && (help.includes("--single") || help.includes("-p"));
  } catch {
    return false;
  }
}

export async function listGrokCliModels(signal?: AbortSignal): Promise<string[]> {
  try {
    const output = await executeCommand("grok", ["models"], undefined, undefined, undefined, 10_000, undefined, signal);
    return output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((model): model is string => Boolean(model && !model.startsWith("Available")));
  } catch (error) {
    throw classifyCliError(error, GROK_CLI_FACTORY_DEFAULT_MODEL);
  }
}

export async function executeGrokCLI(options: GrokCliExecutorOptions): Promise<GrokCliExecutorResult> {
  const model = options.model?.trim() || process.env.ASK_GROK_MODEL || GROK_CLI_FACTORY_DEFAULT_MODEL;
  const reasoningEffort = effort(options.reasoningEffort);
  const timeoutMs = resolveTimeoutMs(EXECUTION.GROK_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_GROK_TIMEOUT_MS);
  const args = [
    "--no-auto-update",
    "-p",
    options.prompt,
    "--output-format",
    "json",
    "--model",
    model,
    "--effort",
    reasoningEffort,
    "--sandbox",
    "read-only",
    "--max-turns",
    "1",
    "--no-subagents",
    "--no-memory",
    "--disable-web-search",
  ];
  const startedAt = Date.now();

  let raw: string;
  try {
    raw = await executeCommand(
      "grok",
      args,
      undefined,
      undefined,
      undefined,
      timeoutMs,
      { sensitiveValues: [options.prompt] },
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw classifyCliError(error, model);
  }

  const envelope = parseEnvelope(raw);
  const content = responseText(envelope);
  if (!content) throw new Error("Grok CLI returned no final response. No fallback was attempted.");
  options.onProgress?.(content.slice(-150));
  const actualModel = envelope.model?.trim() || model;
  const usage: UsageStats = {
    provider: "grok",
    model: actualModel,
    inputTokens: envelope.usage?.input_tokens,
    outputTokens: envelope.usage?.output_tokens,
    cachedTokens: envelope.usage?.cached_tokens,
    thinkingTokens: envelope.usage?.reasoning_tokens,
    durationMs: Date.now() - startedAt,
    fellBack: false,
  };
  return {
    response: `${content}${formatUsageStats(usage)}`,
    model: actualModel,
    sessionId: undefined,
    usage,
    harness: "grok-cli",
  };
}
