import {
  EXECUTION,
  executeCommand,
  formatUsageStats,
  type ProviderName,
  resolveTimeoutMs,
  type UsageStats,
} from "@ask-llm/shared";

interface CursorEvent {
  type?: string;
  subtype?: string;
  model?: string;
  result?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
    reasoning_tokens?: number;
  };
}

export interface CursorAgentOptions {
  prompt: string;
  provider: ProviderName;
  model: string;
  onProgress?: (newOutput: string) => void;
  signal?: AbortSignal;
}

export interface CursorAgentResult {
  response: string;
  model: string;
  provider: ProviderName;
  sessionId: string | undefined;
  usage: UsageStats;
  harness: "cursor-agent";
}

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

function classifyCursorError(error: unknown, model: string): Error {
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
  const timeoutMs = resolveTimeoutMs(EXECUTION.CURSOR_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CURSOR_TIMEOUT_MS);
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--mode",
    "ask",
    "--model",
    model,
    options.prompt,
  ];
  const startedAt = Date.now();

  let raw: string;
  try {
    raw = await executeCommand(
      "agent",
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
    throw classifyCursorError(error, model);
  }

  const events = parseEvents(raw);
  const resultEvent = [...events].reverse().find((event) => event.type === "result");
  const content = resultEvent?.result?.trimEnd();
  if (!content) throw new Error("Cursor Agent returned no final result. No fallback was attempted.");
  options.onProgress?.(content.slice(-150));
  const actualModel = events.find((event) => event.type === "system" && event.subtype === "init")?.model ?? model;
  const usageEvent = [...events].reverse().find((event) => event.usage)?.usage;
  const usage: UsageStats = {
    provider: options.provider,
    model: actualModel,
    inputTokens: usageEvent?.input_tokens,
    outputTokens: usageEvent?.output_tokens,
    cachedTokens: usageEvent?.cached_tokens,
    thinkingTokens: usageEvent?.reasoning_tokens,
    durationMs: Date.now() - startedAt,
    fellBack: false,
  };

  return {
    response: `${content}${formatUsageStats(usage)}`,
    model: actualModel,
    provider: options.provider,
    sessionId: undefined,
    usage,
    harness: "cursor-agent",
  };
}
