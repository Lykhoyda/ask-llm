import {
  appendAndSaveSession,
  buildPriorMessages,
  EXECUTION,
  Logger,
  ResponseCache,
  resolveTimeoutMs,
  responseCache,
  type SessionMessage,
  type UsageStats,
} from "@ask-llm/shared";
import {
  API,
  AVAILABILITY_TIMEOUT_MS,
  DEFAULT_BASE_URL,
  ERROR_MESSAGES,
  MODELS,
  OLLAMA_HOST_ENV,
} from "../constants.js";

interface OllamaChatResponse {
  model: string;
  message?: { role?: string; content?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaErrorResponse {
  error?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

export interface OllamaExecutorOptions {
  prompt: string;
  model?: string;
  sessionId?: string;
  onProgress?: (newOutput: string) => void;
  signal?: AbortSignal;
}

export interface OllamaExecutorResult {
  response: string;
  model: string;
  sessionId: string | undefined;
  usage: UsageStats | undefined;
}

function buildUsageStats(data: OllamaChatResponse, resolvedModel: string, durationMs: number): UsageStats {
  return {
    provider: "ollama",
    model: data.model ?? resolvedModel,
    inputTokens: data.prompt_eval_count,
    outputTokens: data.eval_count,
    cachedTokens: undefined,
    thinkingTokens: undefined,
    durationMs,
    // Local inference has no quota/model fallback, so this is always false.
    fellBack: false,
  };
}

function getBaseUrl(): string {
  const host = process.env[OLLAMA_HOST_ENV];
  if (host) {
    return host.replace(/\/+$/, "");
  }
  return DEFAULT_BASE_URL;
}

function isModelNotFoundError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return ERROR_MESSAGES.MODEL_NOT_FOUND_SIGNALS.some((signal) => lower.includes(signal));
}

function formatStats(promptEvalCount: number | undefined, evalCount: number | undefined, model: string): string {
  const parts: string[] = [];
  if (promptEvalCount != null) parts.push(`${promptEvalCount.toLocaleString()} input tokens`);
  if (evalCount != null) parts.push(`${evalCount.toLocaleString()} output tokens`);
  parts.push(`model: ${model}`);
  return parts.length > 0 ? `\n\n[Ollama stats: ${parts.join(", ")}]` : "";
}

async function callOllama(
  baseUrl: string,
  model: string,
  messages: SessionMessage[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<OllamaChatResponse> {
  const url = `${baseUrl}${API.CHAT}`;
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const timeoutError = () =>
    new Error(
      `Ollama request timed out after ${timeoutMs}ms (model "${model}"). ` +
        `Local models can be slow to load or generate — raise ${EXECUTION.OLLAMA_TIMEOUT_ENV_VAR} if this model legitimately needs longer.`,
    );

  try {
    let response: Response;
    try {
      response = await globalThis.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false }),
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("Ollama request cancelled");
      }
      if (controller.signal.aborted) throw timeoutError();
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`${ERROR_MESSAGES.SERVER_UNREACHABLE} (${msg})`);
    }

    if (!response.ok) {
      let errorBody: OllamaErrorResponse = {};
      try {
        errorBody = (await response.json()) as OllamaErrorResponse;
      } catch {
        /* empty */
      }
      const errorText = errorBody.error ?? `HTTP ${response.status}`;
      throw new Error(errorText);
    }

    // The timer stays armed through the body read: a server that returns
    // headers and then stalls the body would otherwise hang unbounded.
    try {
      return (await response.json()) as OllamaChatResponse;
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("Ollama request cancelled");
      }
      if (controller.signal.aborted) throw timeoutError();
      throw error;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function isProviderAvailable(baseUrl?: string): Promise<boolean> {
  const url = `${baseUrl ?? getBaseUrl()}${API.TAGS}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT_MS);

  try {
    const response = await globalThis.fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

export async function listModels(baseUrl?: string): Promise<string[]> {
  const url = `${baseUrl ?? getBaseUrl()}${API.TAGS}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT_MS);

  try {
    const response = await globalThis.fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return [];
    const data = (await response.json()) as OllamaTagsResponse;
    return data.models?.map((m) => m.name) ?? [];
  } catch {
    clearTimeout(timer);
    return [];
  }
}

export async function executeOllamaCLI(options: OllamaExecutorOptions): Promise<OllamaExecutorResult> {
  const { prompt, sessionId, onProgress } = options;
  const model = options.model || MODELS.DEFAULT;
  const baseUrl = getBaseUrl();

  const priorMessages = buildPriorMessages(sessionId);
  const messages: SessionMessage[] = [...priorMessages, { role: "user", content: prompt }];

  const wantsSession = sessionId !== undefined;
  const cacheKey = wantsSession ? null : ResponseCache.buildKey("ollama", prompt, model);
  if (cacheKey) {
    const cached = responseCache.get(cacheKey);
    if (cached) {
      Logger.debug("Response cache hit for ollama");
      return { response: cached, model, sessionId: undefined, usage: undefined };
    }
  }

  const timeoutMs = resolveTimeoutMs(EXECUTION.OLLAMA_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_OLLAMA_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const data = await callOllama(baseUrl, model, messages, timeoutMs, options.signal);
    const content = data.message?.content ?? "";
    const durationMs = Date.now() - startedAt;

    if (!content) {
      Logger.debug("Ollama returned empty content, using raw response");
      const raw = JSON.stringify(data);
      return {
        response: raw,
        model: data.model ?? model,
        sessionId: undefined,
        usage: buildUsageStats(data, model, durationMs),
      };
    }

    const stored =
      sessionId !== undefined
        ? appendAndSaveSession(sessionId, "ollama", data.model ?? model, prompt, content)
        : undefined;

    const sessionLine = stored ? `\n\n[Session ID: ${stored.id}${stored.created ? " (new)" : ""}]` : "";
    const response = content + formatStats(data.prompt_eval_count, data.eval_count, data.model ?? model) + sessionLine;

    if (onProgress) {
      onProgress(content.slice(-150));
    }

    if (cacheKey) responseCache.set(cacheKey, response);
    return {
      response,
      model: data.model ?? model,
      sessionId: stored?.id,
      usage: buildUsageStats(data, model, durationMs),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (isModelNotFoundError(errorMessage)) {
      // Local inference: no automatic fallback to a different model — surface a clear,
      // actionable error so the user pulls the model they actually intend to run.
      throw new Error(`Ollama model "${model}" is not available locally. Pull it first: ollama pull ${model}`);
    }

    throw error;
  }
}
