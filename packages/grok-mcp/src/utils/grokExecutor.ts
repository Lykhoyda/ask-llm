import {
  EXECUTION,
  formatUsageStats,
  Logger,
  ResponseCache,
  resolveTimeoutMs,
  responseCache,
  type UsageStats,
} from "@ask-llm/shared";
import {
  API,
  ERROR_MESSAGES,
  FACTORY_DEFAULT_REASONING_EFFORT,
  FACTORY_MAX_OUTPUT_TOKENS,
  type GrokReasoningEffort,
  MODEL_DISCOVERY_TIMEOUT_MS,
  MODELS,
  REASONING_EFFORTS,
  XAI_API_BASE_URL,
  XAI_API_KEY_ENV,
} from "../constants.js";
import type { JsonSchema } from "./structuredOutput.js";

interface XaiErrorDetail {
  code?: string;
  message?: string;
  type?: string;
}

interface XaiResponseContent {
  type?: string;
  text?: string;
  refusal?: string;
}

interface XaiResponseOutput {
  type?: string;
  role?: string;
  status?: string;
  content?: XaiResponseContent[];
}

interface XaiUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

interface XaiResponsesPayload {
  id?: string;
  model?: string;
  status?: string;
  error?: XaiErrorDetail | string | null;
  incomplete_details?: { reason?: string } | null;
  output?: XaiResponseOutput[];
  output_text?: string;
  usage?: XaiUsage;
}

interface XaiModelsPayload {
  data?: Array<{ id?: string }>;
}

export interface GrokExecutorOptions {
  prompt: string;
  model?: string;
  reasoningEffort?: GrokReasoningEffort;
  outputSchema?: JsonSchema;
  onProgress?: (newOutput: string) => void;
  signal?: AbortSignal;
}

export interface GrokExecutorResult {
  response: string;
  model: string;
  sessionId: undefined;
  usage: UsageStats | undefined;
  harness: "xai-api";
}

function cachedResult(value: string): GrokExecutorResult | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isObject(parsed) || typeof parsed.response !== "string" || typeof parsed.model !== "string") return null;
    return {
      response: parsed.response,
      model: parsed.model,
      sessionId: undefined,
      usage: undefined,
      harness: "xai-api",
    };
  } catch {
    return null;
  }
}

function apiKey(): string {
  const value = process.env[XAI_API_KEY_ENV]?.trim();
  if (!value) throw new Error(ERROR_MESSAGES.MISSING_CREDENTIALS);
  return value;
}

function cleanDetail(value: unknown, secret: string): string {
  const raw = typeof value === "string" ? value : value instanceof Error ? value.message : String(value ?? "");
  const redacted = secret ? raw.replaceAll(secret, "[REDACTED]") : raw;
  return redacted.replace(/\s+/g, " ").trim().slice(0, EXECUTION.ERROR_TRUNCATE_LENGTH);
}

function errorDetail(error: XaiErrorDetail | string | null | undefined, secret: string): string {
  if (typeof error === "string") return cleanDetail(error, secret);
  if (!error) return "";
  return cleanDetail([error.code, error.type, error.message].filter(Boolean).join(": "), secret);
}

function isReasoningEffort(value: string): value is GrokReasoningEffort {
  return REASONING_EFFORTS.some((effort) => effort === value);
}

function reasoningEffort(value?: GrokReasoningEffort): GrokReasoningEffort {
  const configured = value ?? process.env.ASK_GROK_REASONING_EFFORT ?? FACTORY_DEFAULT_REASONING_EFFORT;
  if (isReasoningEffort(configured)) return configured;
  throw new Error(
    `Unsupported Grok reasoning effort "${cleanDetail(configured, "")}". Use one of: ${REASONING_EFFORTS.join(", ")}.`,
  );
}

function buildUsageStats(payload: XaiResponsesPayload, model: string, durationMs: number): UsageStats {
  return {
    provider: "grok",
    model,
    inputTokens: payload.usage?.input_tokens,
    outputTokens: payload.usage?.output_tokens,
    cachedTokens: payload.usage?.input_tokens_details?.cached_tokens,
    thinkingTokens: payload.usage?.output_tokens_details?.reasoning_tokens,
    durationMs,
    fellBack: false,
  };
}

function outputText(payload: XaiResponsesPayload, secret: string): string {
  const refusals: string[] = [];
  const text: string[] = [];

  if (typeof payload.output_text === "string" && payload.output_text.length > 0) text.push(payload.output_text);
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" || typeof content.refusal === "string") {
        refusals.push(content.refusal ?? content.text ?? "request refused");
      } else if (content.type === "output_text" && typeof content.text === "string") {
        text.push(content.text);
      }
    }
  }

  if (refusals.length > 0) {
    const detail = cleanDetail(refusals.join(" "), secret);
    throw new Error(`${ERROR_MESSAGES.SAFETY_REFUSAL}${detail ? ` Detail: ${detail}` : ""}`);
  }
  return text.join("");
}

function looksLikeModelError(detail: string): boolean {
  const lower = detail.toLowerCase();
  return ["model_not_found", "invalid_model", "unknown model", "unsupported model", "does not exist"].some((part) =>
    lower.includes(part),
  );
}

function looksLikeSafetyError(detail: string): boolean {
  const lower = detail.toLowerCase();
  return ["safety", "usage guideline", "policy violation", "content policy", "moderation"].some((part) =>
    lower.includes(part),
  );
}

function looksLikeQuotaError(detail: string): boolean {
  const lower = detail.toLowerCase();
  return ["quota", "rate limit", "rate_limit", "insufficient", "credit", "billing", "too many requests"].some((part) =>
    lower.includes(part),
  );
}

function httpError(status: number, detail: string, model: string): Error {
  if (status === 401 || status === 403) return new Error(ERROR_MESSAGES.INVALID_CREDENTIALS);
  if (looksLikeSafetyError(detail)) {
    return new Error(`${ERROR_MESSAGES.SAFETY_REFUSAL}${detail ? ` Detail: ${detail}` : ""}`);
  }
  if (status === 402 || status === 429 || looksLikeQuotaError(detail)) return new Error(ERROR_MESSAGES.RATE_LIMITED);
  if (status === 404 || looksLikeModelError(detail)) {
    return new Error(
      `Grok model "${model}" is not available to this xAI API team. Discover exact IDs with GET ${XAI_API_BASE_URL}${API.MODELS}, then request one explicitly or update ASK_GROK_MODEL. No fallback was attempted.`,
    );
  }
  if (status >= 500) {
    return new Error(
      `Grok API transport failed with HTTP ${status}${detail ? `: ${detail}` : ""}. Retry later or check xAI service status. No fallback was attempted.`,
    );
  }
  return new Error(
    `Grok API rejected the request with HTTP ${status}${detail ? `: ${detail}` : ""}. Check the exact model ID and JSON Schema. No fallback was attempted.`,
  );
}

async function parseJson(response: Response, controller: AbortController, callerSignal: AbortSignal | undefined) {
  try {
    const body: unknown = await response.json();
    return body;
  } catch (error) {
    if (callerSignal?.aborted) {
      throw callerSignal.reason instanceof Error ? callerSignal.reason : new Error("Grok request cancelled");
    }
    if (controller.signal.aborted) throw error;
    throw new Error(ERROR_MESSAGES.MALFORMED_RESPONSE);
  }
}

async function requestJson(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  secret: string,
  signal?: AbortSignal,
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await globalThis.fetch(`${XAI_API_BASE_URL}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("Grok request cancelled");
      }
      if (controller.signal.aborted) {
        throw new Error(
          `Grok request timed out after ${timeoutMs}ms. Raise ${EXECUTION.GROK_TIMEOUT_ENV_VAR} if this reasoning request legitimately needs longer. The underlying HTTP request was aborted.`,
        );
      }
      const detail = cleanDetail(error, secret);
      throw new Error(
        `Grok API transport failed before receiving a response${detail ? `: ${detail}` : ""}. Check network access to ${XAI_API_BASE_URL}. No fallback was attempted.`,
      );
    }

    const body = await parseJson(response, controller, signal);
    return { response, body };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function maxOutputTokens(): number {
  const configured = process.env.ASK_GROK_MAX_OUTPUT_TOKENS;
  if (!configured) return FACTORY_MAX_OUTPUT_TOKENS;
  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) {
    throw new Error("ASK_GROK_MAX_OUTPUT_TOKENS must be an integer from 1 to 100000.");
  }
  return parsed;
}

function requestBody(
  options: GrokExecutorOptions,
  model: string,
  effort: GrokReasoningEffort,
  outputTokenLimit: number,
): Record<string, unknown> {
  return {
    model,
    input: options.prompt,
    store: false,
    max_output_tokens: outputTokenLimit,
    reasoning: { effort },
    ...(options.outputSchema
      ? {
          text: {
            format: {
              type: "json_schema",
              name: "ask_llm_response",
              strict: true,
              schema: options.outputSchema,
            },
          },
        }
      : {}),
  };
}

export function isProviderAvailable(): Promise<boolean> {
  return Promise.resolve(Boolean(process.env[XAI_API_KEY_ENV]?.trim()));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isModelsPayload(value: unknown): value is XaiModelsPayload & { error?: XaiErrorDetail | string } {
  return isObject(value);
}

function isResponsesPayload(value: unknown): value is XaiResponsesPayload {
  return isObject(value);
}

export async function listModels(signal?: AbortSignal): Promise<string[]> {
  const secret = apiKey();
  const { response, body } = await requestJson(
    API.MODELS,
    { headers: { Authorization: `Bearer ${secret}` } },
    MODEL_DISCOVERY_TIMEOUT_MS,
    secret,
    signal,
  );
  if (!isModelsPayload(body)) throw new Error("Grok model discovery returned a malformed response.");
  const payload = body;
  if (!response.ok) throw httpError(response.status, errorDetail(payload.error, secret), MODELS.DEFAULT);
  if (!Array.isArray(payload.data)) throw new Error("Grok model discovery returned a malformed response.");
  return payload.data.flatMap((entry) => (typeof entry.id === "string" ? [entry.id] : []));
}

export async function executeGrokAPI(options: GrokExecutorOptions): Promise<GrokExecutorResult> {
  const secret = apiKey();
  const model = options.model?.trim() || MODELS.DEFAULT;
  const effort = reasoningEffort(options.reasoningEffort);
  const outputTokenLimit = maxOutputTokens();
  const cacheKey = options.outputSchema
    ? null
    : ResponseCache.buildKey("grok", options.prompt, `${model}:${effort}:${outputTokenLimit}`);
  if (cacheKey) {
    const cached = responseCache.get(cacheKey);
    if (cached) {
      const result = cachedResult(cached);
      if (result) {
        Logger.debug("Response cache hit for grok");
        return result;
      }
    }
  }

  const timeoutMs = resolveTimeoutMs(EXECUTION.GROK_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_GROK_TIMEOUT_MS);
  const startedAt = Date.now();
  const { response, body } = await requestJson(
    API.RESPONSES,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody(options, model, effort, outputTokenLimit)),
    },
    timeoutMs,
    secret,
    options.signal,
  );
  if (!isResponsesPayload(body)) throw new Error(ERROR_MESSAGES.MALFORMED_RESPONSE);
  const payload = body;
  const detail = errorDetail(payload.error, secret);
  if (!response.ok) throw httpError(response.status, detail, model);
  if (payload.error) throw httpError(500, detail, model);
  if (payload.status === "incomplete") {
    const reason = cleanDetail(payload.incomplete_details?.reason, secret);
    throw new Error(
      `Grok response was incomplete${reason ? ` (${reason})` : ""}. Reduce the request or output size and retry. No fallback was attempted.`,
    );
  }
  if (payload.status && payload.status !== "completed") {
    throw new Error(`Grok API returned unexpected response status "${cleanDetail(payload.status, secret)}".`);
  }

  const content = outputText(payload, secret);
  if (!content) throw new Error(ERROR_MESSAGES.MALFORMED_RESPONSE);
  const actualModel = typeof payload.model === "string" && payload.model.trim() ? payload.model : model;
  const usage = buildUsageStats(payload, actualModel, Date.now() - startedAt);
  const formatted = `${content}${formatUsageStats(usage)}`;

  options.onProgress?.(content.slice(-150));
  const result: GrokExecutorResult = {
    response: formatted,
    model: actualModel,
    sessionId: undefined,
    usage,
    harness: "xai-api",
  };
  if (cacheKey) responseCache.set(cacheKey, JSON.stringify({ response: formatted, model: actualModel }));
  return result;
}
