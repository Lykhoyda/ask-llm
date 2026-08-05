import { EXECUTION, executeCommand, resolveTimeoutMs, type UsageStats } from "@ask-llm/shared";
import {
  ALLOW_NESTED_ENV_VAR,
  CLAUDE_HOST_ENV_VAR,
  CLI,
  ERROR_MESSAGES,
  MODELS,
  READ_ONLY_SYSTEM_PROMPT,
} from "../constants.js";

interface ClaudeTokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
}

interface ClaudeJsonResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  session_id?: unknown;
  duration_ms?: number;
  usage?: ClaudeTokenUsage;
  modelUsage?: Record<string, ClaudeModelUsage>;
}

export interface ClaudeExecutorOptions {
  prompt: string;
  model?: string;
  sessionId?: string;
  includeDirs?: string[];
  onProgress?: (newOutput: string) => void;
  signal?: AbortSignal;
}

export interface ClaudeExecutorResult {
  response: string;
  model: string;
  sessionId: string | undefined;
  usage: UsageStats;
}

function pickPrimaryModel(
  modelUsage: Record<string, ClaudeModelUsage> | undefined,
): { model: string; usage: ClaudeModelUsage } | undefined {
  if (!modelUsage) return undefined;
  let best: { model: string; usage: ClaudeModelUsage } | undefined;
  for (const [model, usage] of Object.entries(modelUsage)) {
    const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    const bestTokens = best ? (best.usage.inputTokens ?? 0) + (best.usage.outputTokens ?? 0) : -1;
    if (tokens > bestTokens) best = { model, usage };
  }
  return best;
}

function didFallBack(requestedModel: string, actualModel: string): boolean {
  const requested = requestedModel.toLowerCase();
  const actual = actualModel.toLowerCase();
  return !(actual === requested || actual.includes(requested));
}

function extractJsonObject(raw: string): ClaudeJsonResult {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as ClaudeJsonResult;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as ClaudeJsonResult;
      } catch {
        // Fall through to the actionable parse error below.
      }
    }
    throw new Error(`${ERROR_MESSAGES.INVALID_JSON}\nRaw output (truncated): ${trimmed.slice(0, 500)}`);
  }
}

export function parseClaudeJsonOutput(
  raw: string,
  requestedModel: string,
  measuredDurationMs: number,
): ClaudeExecutorResult {
  const json = extractJsonObject(raw);
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error(ERROR_MESSAGES.INVALID_JSON);
  }
  if (json.is_error || (json.subtype && json.subtype !== "success")) {
    const message = typeof json.result === "string" && json.result.trim() ? json.result : JSON.stringify(json);
    throw new Error(`Claude CLI error: ${message}`);
  }
  if (typeof json.result !== "string" || !json.result.trim()) {
    throw new Error(ERROR_MESSAGES.EMPTY_RESPONSE);
  }

  const primary = pickPrimaryModel(json.modelUsage);
  const model = primary?.model ?? requestedModel;
  const fallbackUsage = json.usage;
  const usage: UsageStats = {
    provider: "claude",
    model,
    inputTokens: primary?.usage.inputTokens ?? fallbackUsage?.input_tokens,
    outputTokens: primary?.usage.outputTokens ?? fallbackUsage?.output_tokens,
    cachedTokens: primary?.usage.cacheReadInputTokens ?? fallbackUsage?.cache_read_input_tokens,
    thinkingTokens: undefined,
    durationMs: json.duration_ms ?? measuredDurationMs,
    fellBack: didFallBack(requestedModel, model),
  };

  return {
    response: json.result,
    model,
    sessionId: typeof json.session_id === "string" && json.session_id ? json.session_id : undefined,
    usage,
  };
}

export function buildArgs(model: string, fallbackModel: string, sessionId?: string, includeDirs?: string[]): string[] {
  const args = [
    CLI.FLAGS.PRINT,
    CLI.FLAGS.OUTPUT_FORMAT,
    CLI.FLAGS.JSON,
    CLI.FLAGS.SAFE_MODE,
    CLI.FLAGS.TOOLS,
    CLI.FLAGS.READ_ONLY_TOOLS,
    CLI.FLAGS.PERMISSION_MODE,
    CLI.FLAGS.DONT_ASK,
    CLI.FLAGS.APPEND_SYSTEM_PROMPT,
    READ_ONLY_SYSTEM_PROMPT,
    CLI.FLAGS.MODEL,
    model,
  ];
  if (fallbackModel && fallbackModel !== model) args.push(CLI.FLAGS.FALLBACK_MODEL, fallbackModel);
  if (includeDirs?.length) {
    for (const dir of includeDirs) args.push(CLI.FLAGS.ADD_DIR, dir);
  }
  if (sessionId) args.push(CLI.FLAGS.RESUME, sessionId);
  return args;
}

// Exported for unit testing — pure predicate over the two env vars. The guard
// only fires inside an actual Claude Code session; IDE integrated terminals that
// set CLAUDECODE can opt out via ASK_CLAUDE_ALLOW_NESTED ("1"/"true"). ADR-134.
export function isNestedSessionBlocked(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env[CLAUDE_HOST_ENV_VAR]) return false;
  const override = env[ALLOW_NESTED_ENV_VAR];
  return override !== "1" && override !== "true";
}

export async function executeClaudeCLI(options: ClaudeExecutorOptions): Promise<ClaudeExecutorResult> {
  if (isNestedSessionBlocked()) throw new Error(ERROR_MESSAGES.NESTED_SESSION);
  const model = options.model?.trim() || MODELS.DEFAULT;
  const fallbackModel = MODELS.FALLBACK;
  const args = buildArgs(model, fallbackModel, options.sessionId, options.includeDirs);
  const timeoutMs = resolveTimeoutMs(EXECUTION.CLAUDE_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CLAUDE_TIMEOUT_MS);
  const startedAt = Date.now();
  // Claude --print --output-format json returns one completion object, not
  // incremental JSONL. Keep raw stdout out of previews and emit the parsed
  // final response below.
  const raw = await executeCommand(
    CLI.COMMAND,
    args,
    undefined,
    undefined,
    options.prompt,
    timeoutMs,
    undefined,
    options.signal,
  );
  const result = parseClaudeJsonOutput(raw, model, Date.now() - startedAt);
  options.onProgress?.(result.response);
  return result;
}
