import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXECUTION, executeCommand, formatUsageStats, resolveTimeoutMs, type UsageStats } from "@ask-llm/shared";
import {
  ERROR_MESSAGES,
  FACTORY_DEFAULT_REASONING_EFFORT,
  GROK_CLI_FACTORY_DEFAULT_MODEL,
  type GrokReasoningEffort,
  REASONING_EFFORTS,
} from "../constants.js";
import { constrainPromptToSchema, type JsonSchema } from "./structuredOutput.js";

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
  outputSchema?: JsonSchema;
  onProgress?: (newOutput: string) => void;
  signal?: AbortSignal;
}

export interface GrokCliExecutorResult {
  response: string;
  model: string;
  reportedModel: string | undefined;
  sessionId: undefined;
  usage: UsageStats;
  harness: "grok-cli";
}

export const GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES = EXECUTION.STDIN_THRESHOLD_BYTES;
const GROK_CLI_PROMPT_FILE_FLAG = "--prompt-file";
const CAPABILITY_PROBE_TIMEOUT_MS = 5000;

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

function classifyCliError(error: unknown, model: string, promptFile = false): Error {
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
  if (promptFile && lower.includes("prompt-file")) {
    return new Error(
      `Grok CLI rejected --prompt-file, which Ask LLM uses for prompts larger than ${GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES} bytes: ${detail}. Update Grok Build to a version that supports --prompt-file, or shorten the prompt. No fallback was attempted.`,
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

async function readGrokHelp(signal?: AbortSignal): Promise<string> {
  return executeCommand(
    "grok",
    ["--help"],
    undefined,
    undefined,
    undefined,
    CAPABILITY_PROBE_TIMEOUT_MS,
    undefined,
    signal,
  );
}

export async function probeGrokCli(): Promise<boolean> {
  try {
    const help = await readGrokHelp();
    return help.includes("--output-format") && (help.includes("--single") || help.includes("-p"));
  } catch {
    return false;
  }
}

export async function probeGrokPromptFileSupport(signal?: AbortSignal): Promise<boolean> {
  return (await readGrokHelp(signal)).includes(GROK_CLI_PROMPT_FILE_FLAG);
}

async function assertPromptFileSupport(promptBytes: number, model: string, signal?: AbortSignal): Promise<void> {
  let supported: boolean;
  try {
    supported = await probeGrokPromptFileSupport(signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw classifyCliError(error, model);
  }
  if (supported) return;
  throw new Error(
    `Grok CLI prompt is ${promptBytes} bytes, above the ${GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES}-byte argv threshold, but the installed Grok Build does not advertise ${GROK_CLI_PROMPT_FILE_FLAG} in \`grok --help\`. Update Grok Build (1.0.5 and later document ${GROK_CLI_PROMPT_FILE_FLAG}) or shorten the prompt. Ask LLM does not retry large prompts on argv, and no fallback was attempted.`,
  );
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

interface PromptFile {
  path: string;
  cleanup: () => Promise<void>;
}

async function writePromptFile(prompt: string): Promise<PromptFile> {
  let directory: string;
  try {
    directory = await mkdtemp(join(tmpdir(), "ask-grok-prompt-"));
  } catch (error) {
    throw new Error(
      `Grok CLI prompt exceeds ${GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES} bytes but Ask LLM could not create a private temp directory for --prompt-file: ${redactCliSecrets(error instanceof Error ? error.message : String(error))}. Shorten the prompt or fix the temp directory. No fallback was attempted.`,
    );
  }
  const cleanup = () => rm(directory, { recursive: true, force: true }).catch(() => undefined);
  const path = join(directory, "prompt.md");
  try {
    await writeFile(path, prompt, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    await cleanup();
    throw new Error(
      `Grok CLI prompt exceeds ${GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES} bytes but Ask LLM could not write the private --prompt-file: ${redactCliSecrets(error instanceof Error ? error.message : String(error))}. Shorten the prompt or fix the temp directory. No fallback was attempted.`,
    );
  }
  return { path, cleanup };
}

export async function executeGrokCLI(options: GrokCliExecutorOptions): Promise<GrokCliExecutorResult> {
  const model = options.model?.trim() || process.env.ASK_GROK_MODEL || GROK_CLI_FACTORY_DEFAULT_MODEL;
  const reasoningEffort = effort(options.reasoningEffort);
  const timeoutMs = resolveTimeoutMs(EXECUTION.GROK_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_GROK_TIMEOUT_MS);
  const prompt = options.outputSchema ? constrainPromptToSchema(options.prompt, options.outputSchema) : options.prompt;
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  const usePromptFile = promptBytes > GROK_CLI_PROMPT_FILE_THRESHOLD_BYTES;
  if (usePromptFile) await assertPromptFileSupport(promptBytes, model, options.signal);
  const promptFile = usePromptFile ? await writePromptFile(prompt) : undefined;
  const args = [
    "--no-auto-update",
    ...(promptFile ? [GROK_CLI_PROMPT_FILE_FLAG, promptFile.path] : ["-p", prompt]),
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
      { sensitiveValues: promptFile ? [] : [prompt] },
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw classifyCliError(error, model, usePromptFile);
  } finally {
    await promptFile?.cleanup();
  }

  const envelope = parseEnvelope(raw);
  const content = responseText(envelope);
  if (!content) throw new Error("Grok CLI returned no final response. No fallback was attempted.");
  options.onProgress?.(content.slice(-150));
  const reportedModel = envelope.model?.trim() || undefined;
  const actualModel = reportedModel ?? model;
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
    reportedModel,
    sessionId: undefined,
    usage,
    harness: "grok-cli",
  };
}
