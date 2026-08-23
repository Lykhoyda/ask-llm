import {
  CURSOR_PROVIDERS,
  type CursorProviderName,
  cursorModelFamily,
  EXECUTION,
  executeCommand,
  formatUsageStats,
  relativeDirSchema,
  resolveTimeoutMs,
  type UsageStats,
} from "@ask-llm/shared";

export { CURSOR_PROVIDERS, type CursorProviderName, cursorModelFamily } from "@ask-llm/shared";

interface CursorEvent {
  type?: string;
  subtype?: string;
  model?: string;
  result?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
  session_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
    reasoning_tokens?: number;
  };
}

export interface CursorAgentOptions {
  prompt: string;
  provider: CursorProviderName;
  model: string;
  includeDirs?: string[];
  sessionId?: string;
  onProgress?: (newOutput: string) => void;
  signal?: AbortSignal;
}

export interface CursorAgentResult {
  response: string;
  model: string;
  reportedModel: string | undefined;
  provider: CursorProviderName;
  sessionId: string | undefined;
  usage: UsageStats;
  harness: "cursor-agent";
}

export const CURSOR_STDIN_THRESHOLD_BYTES = EXECUTION.STDIN_THRESHOLD_BYTES;

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

function redactCursorSecrets(message: string): string {
  let result = message;
  for (const secret of [process.env.CURSOR_API_KEY].filter(isPresent)) {
    result = result.replaceAll(secret, "[REDACTED]");
  }
  return result.slice(0, EXECUTION.ERROR_TRUNCATE_LENGTH);
}

function classifyCursorError(error: unknown, model: string, promptViaStdin = false): Error {
  const detail = redactCursorSecrets(error instanceof Error ? error.message : String(error));
  const lower = detail.toLowerCase();
  if (lower.includes("not found") || lower.includes("enoent")) {
    return new Error(
      "Cursor Agent harness is unavailable. Install Cursor CLI and verify `agent --version`. No provider or model fallback was attempted.",
    );
  }
  if (["unauthorized", "authentication", "login", "api key", "401", "403"].some((part) => lower.includes(part))) {
    return new Error(
      "Cursor Agent authentication failed. Run `agent login` or configure CURSOR_API_KEY. Credentials were not logged or returned. No fallback was attempted.",
    );
  }
  if (["unknown model", "invalid model", "model not found", "unsupported model"].some((part) => lower.includes(part))) {
    return new Error(
      `Cursor Agent model "${model}" is unavailable. Run \`agent --list-models\` and pass an exact listed ID. No fallback was attempted.`,
    );
  }
  if (
    ["rate limit", "quota", "usage limit", "credit", "spend", "429", "capacity"].some((part) => lower.includes(part))
  ) {
    return new Error(
      "Cursor Agent quota or spend limit was reached. Check Cursor usage settings. Ask LLM does not enable on-demand spend, raise limits, or retry another model/provider.",
    );
  }
  if (lower.includes("trust")) {
    return new Error(
      "Cursor Agent requires this workspace to be trusted. Trust it explicitly in Cursor before using the headless harness; Ask LLM never passes --trust automatically.",
    );
  }
  if (["safety", "policy", "refus"].some((part) => lower.includes(part))) {
    return new Error("Cursor Agent returned a safety refusal. Revise the prompt; no fallback was attempted.");
  }
  if (promptViaStdin && lower.includes("prompt")) {
    return new Error(
      `Cursor Agent did not accept a prompt larger than ${CURSOR_STDIN_THRESHOLD_BYTES} bytes over stdin: ${detail}. Update Cursor CLI to a version that reads piped prompts, or shorten the prompt. No fallback was attempted.`,
    );
  }
  return new Error(`Cursor Agent harness failed: ${detail}. No fallback was attempted.`);
}

function parseEvents(raw: string): CursorEvent[] {
  const events: CursorEvent[] = [];
  for (const line of raw
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)) {
    try {
      const event: CursorEvent = JSON.parse(line);
      if (event && typeof event === "object") events.push(event);
    } catch {
      // Non-protocol notices are ignored; a final result event is still required.
    }
  }
  if (events.length === 0) {
    try {
      const event: CursorEvent = JSON.parse(raw);
      events.push(event);
    } catch {
      throw new Error(
        "Cursor Agent returned malformed JSON output. Update the CLI and retry; no fallback was attempted.",
      );
    }
  }
  return events;
}

function assertRequestedModelFamily(provider: CursorProviderName, model: string): void {
  const family = cursorModelFamily(model);
  const catalog = CURSOR_PROVIDERS.join(", ");
  if (family === null) {
    throw new Error(
      `Cursor Agent requested model "${model}" does not belong to a canonical provider family (${catalog}). Ask LLM refuses Cursor Auto and other noncanonical catalog IDs; choose an exact provider-backed ID from \`agent --list-models\`. No fallback was attempted.`,
    );
  }
  if (family !== provider) {
    throw new Error(
      `Cursor Agent requested model "${model}" belongs to provider "${family}", not the requested provider "${provider}". Pass provider="${family}" or choose a ${provider} model from \`agent --list-models\`. Ask LLM does not rewrite the attribution. No fallback was attempted.`,
    );
  }
}

function assertReportedModelFamily(provider: CursorProviderName, model: string, reportedModel: string): void {
  const family = cursorModelFamily(reportedModel);
  if (family === null || family === provider) return;
  throw new Error(
    `Cursor Agent reported model "${reportedModel}" (provider "${family}") for requested ${provider} model "${model}". Ask LLM refuses cross-provider substitution and does not retry. No fallback was attempted.`,
  );
}

function reportedModelFooter(model: string, reportedModel: string | undefined): string {
  if (!reportedModel || reportedModel === model) return "";
  return `\n[Cursor Agent reported model: ${reportedModel}]`;
}

export async function probeCursorAgent(): Promise<boolean> {
  try {
    const help = await executeCommand("agent", ["--help"], undefined, undefined, undefined, 5000);
    return help.includes("--output-format") && help.includes("--mode") && help.includes("--model");
  } catch {
    return false;
  }
}

export async function listCursorModels(signal?: AbortSignal): Promise<string[]> {
  try {
    const output = await executeCommand(
      "agent",
      ["--list-models"],
      undefined,
      undefined,
      undefined,
      10_000,
      undefined,
      signal,
    );
    return output
      .split(/\r?\n/)
      .map((line) => line.match(/^([^\s]+)\s+-\s+/)?.[1])
      .filter((model): model is string => Boolean(model));
  } catch (error) {
    throw classifyCursorError(error, "<discovery>");
  }
}

export async function executeCursorAgent(options: CursorAgentOptions): Promise<CursorAgentResult> {
  const model = options.model.trim();
  if (!model) throw new Error("Cursor Agent requires an exact model ID from `agent --list-models`.");
  if (!CURSOR_PROVIDERS.includes(options.provider)) {
    throw new Error(
      `Cursor Agent provider "${String(options.provider)}" is not a canonical Cursor catalog provider (${CURSOR_PROVIDERS.join(", ")}). No fallback was attempted.`,
    );
  }
  assertRequestedModelFamily(options.provider, model);
  const timeoutMs = resolveTimeoutMs(EXECUTION.CURSOR_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CURSOR_TIMEOUT_MS);
  const promptViaStdin = Buffer.byteLength(options.prompt, "utf8") > CURSOR_STDIN_THRESHOLD_BYTES;
  const includeDirs = (options.includeDirs ?? []).map((dir) => relativeDirSchema.parse(dir));
  const sessionId = options.sessionId?.trim() || undefined;
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--mode",
    "ask",
    "--model",
    model,
    ...(sessionId ? ["--resume", sessionId] : []),
    ...includeDirs.flatMap((dir) => ["--add-dir", dir]),
    ...(promptViaStdin ? [] : [options.prompt]),
  ];
  const startedAt = Date.now();

  let raw: string;
  try {
    raw = await executeCommand(
      "agent",
      args,
      undefined,
      undefined,
      promptViaStdin ? options.prompt : undefined,
      timeoutMs,
      { sensitiveValues: promptViaStdin ? [] : [options.prompt] },
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw classifyCursorError(error, model, promptViaStdin);
  }

  const events = parseEvents(raw);
  const resultEvent = [...events].reverse().find((event) => event.type === "result");
  const content = resultEvent?.result?.trimEnd();
  if (!content) throw new Error("Cursor Agent returned no final result. No fallback was attempted.");
  const initEvent = events.find((event) => event.type === "system" && event.subtype === "init");
  const reportedModel = initEvent?.model?.trim() || undefined;
  const resolvedSessionId = initEvent?.session_id?.trim() || sessionId;
  if (reportedModel) assertReportedModelFamily(options.provider, model, reportedModel);
  options.onProgress?.(content.slice(-150));
  const usageEvent = [...events].reverse().find((event) => event.usage)?.usage;
  const usage: UsageStats = {
    provider: options.provider,
    model,
    inputTokens: usageEvent?.input_tokens,
    outputTokens: usageEvent?.output_tokens,
    cachedTokens: usageEvent?.cached_tokens,
    thinkingTokens: usageEvent?.reasoning_tokens,
    durationMs: Date.now() - startedAt,
    fellBack: false,
  };

  return {
    response: `${content}${formatUsageStats(usage)}${reportedModelFooter(model, reportedModel)}`,
    model,
    reportedModel,
    provider: options.provider,
    sessionId: resolvedSessionId,
    usage,
    harness: "cursor-agent",
  };
}
