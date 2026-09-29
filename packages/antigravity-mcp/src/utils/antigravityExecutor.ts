import { EXECUTION, executeCommand, Logger, resolveTimeoutMs, type UsageStats } from "@ask-llm/shared";
import { ANTIGRAVITY, CLI, ERROR_MESSAGES, MODELS, OUTPUT_FORMATS, READ_ONLY_PREAMBLE } from "../constants.js";
import { assertSupportedAgyVersion, isVersionAtLeast } from "./agyVersion.js";

export { assessAgyVersion, probeAgySupport } from "./agyVersion.js";

export interface AntigravityExecutorOptions {
  prompt: string;
  includeDirs?: string[];
  // agy model slug; legacy effort-carrying display strings remain compatible.
  model?: string;
  // Accepted for ExecutorFn compatibility; conversation_id resume remains follow-up work.
  sessionId?: string;
  readOnly?: boolean;
  onProgress?: (newOutput: string) => void;
  signal?: AbortSignal;
  singleAttempt?: boolean;
}

export interface AntigravityExecutorResult {
  response: string;
  model: string;
  sessionId: undefined;
  usage: UsageStats | undefined;
}

export function buildArgs(
  prompt: string,
  includeDirs: string[] | undefined,
  timeoutSec: number,
  sandbox: boolean,
  model: string | undefined,
  readOnly = false,
  effort?: string,
  disableSlashCommands = false,
): string[] {
  const args: string[] = [CLI.FLAGS.PRINT, prompt];
  if (includeDirs?.length) {
    for (const dir of includeDirs) args.push(CLI.FLAGS.ADD_DIR, dir);
  }
  if (model) args.push(CLI.FLAGS.MODEL, model);
  if (effort) args.push(CLI.FLAGS.EFFORT, effort);
  args.push(CLI.FLAGS.PRINT_TIMEOUT, `${timeoutSec}s`);
  args.push(CLI.FLAGS.OUTPUT_FORMAT, OUTPUT_FORMATS.JSON);
  if (disableSlashCommands) args.push(CLI.FLAGS.DISABLE_SLASH_COMMANDS);
  if (readOnly) {
    args.push(CLI.FLAGS.MODE, CLI.FLAGS.PLAN, CLI.FLAGS.SANDBOX);
  } else {
    if (sandbox) args.push(CLI.FLAGS.SANDBOX);
  }
  return args;
}

interface AgyStdoutUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  // Absent on agy 1.1.5; reported from 1.1.7 onwards.
  cache_read_tokens?: number;
}

interface AgyStdoutJson {
  response?: unknown;
  usage?: AgyStdoutUsage;
  truncated?: unknown;
  denied_actions?: unknown;
  status?: unknown;
}

type StdoutParse =
  | {
      kind: "answer";
      response: string;
      usage: AgyStdoutUsage | undefined;
      truncated: boolean;
      deniedNotice: string | undefined;
    }
  | { kind: "envelope-without-answer"; truncated: boolean; deniedNotice: string | undefined }
  | { kind: "not-json" };

export function isPrintTimeoutTruncation(message: string): boolean {
  const lower = message.toLowerCase();
  return ANTIGRAVITY.PRINT_TIMEOUT_TRUNCATION_SIGNALS.some((s) => lower.includes(s));
}

function envelopeLooksTruncated(parsed: AgyStdoutJson): boolean {
  if (parsed.truncated === true) return true;
  if (typeof parsed.status !== "string") return false;
  const status = parsed.status.toLowerCase();
  if (status === "timeout" || status === "partial" || status === "truncated") return true;
  return isPrintTimeoutTruncation(parsed.status);
}

function formatDeniedActions(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const names = value.map((item) => {
    if (typeof item === "string") return item;
    if (typeof item?.action === "string") return item.action;
    try {
      return JSON.stringify(item);
    } catch {
      return String(item);
    }
  });
  return `agy denied ${names.length} action(s): ${names.join(", ")}`;
}

function envelopeMeta(parsed: AgyStdoutJson): { truncated: boolean; deniedNotice: string | undefined } {
  return { truncated: envelopeLooksTruncated(parsed), deniedNotice: formatDeniedActions(parsed.denied_actions) };
}

function previewPartial(partial: string | undefined): string | undefined {
  const t = partial?.trim();
  if (!t) return undefined;
  if (t.length <= ANTIGRAVITY.PARTIAL_OUTPUT_PREVIEW_CHARS) return t;
  return `${t.slice(0, ANTIGRAVITY.PARTIAL_OUTPUT_PREVIEW_CHARS)}... (truncated)`;
}

function truncatedAnswerMessage(timeoutMs: number, partial?: string, deniedNotice?: string): string {
  const parts = [
    ERROR_MESSAGES.TRUNCATED,
    `Increase ${ANTIGRAVITY.TIMEOUT_ENV_VAR} (current: ${timeoutMs}ms) or shorten the prompt.`,
  ];
  if (deniedNotice) parts.push(deniedNotice);
  const preview = previewPartial(partial);
  if (preview) parts.push("Partial output follows:", preview);
  return parts.join(" ");
}

function appendDeniedNotice(response: string, notice: string | undefined): string {
  return notice ? `${response}\n\n[${notice}]` : response;
}

// Parsed JSON envelopes never fall through to raw stdout; see ADR-141.
function parseStdoutJson(raw: string): StdoutParse {
  const t = raw.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return { kind: "not-json" };
  let parsed: AgyStdoutJson;
  try {
    parsed = JSON.parse(t) as AgyStdoutJson;
  } catch {
    // JSON-looking but unparsable output is a corrupt envelope, not legacy text.
    return { kind: "envelope-without-answer", truncated: false, deniedNotice: undefined };
  }
  const meta = envelopeMeta(parsed);
  if (typeof parsed.response !== "string") return { kind: "envelope-without-answer", ...meta };
  // Preserve the transcript-era response bytes by removing agy's envelope-only trailing newline.
  const response = parsed.response.trimEnd();
  if (response.length === 0) return { kind: "envelope-without-answer", ...meta };
  const usage = parsed.usage && typeof parsed.usage === "object" ? parsed.usage : undefined;
  return { kind: "answer", response, usage, ...meta };
}

// Read-only slash commands answer without an agent turn or quota use (agy >=1.1.11).
async function describeQuota(signal?: AbortSignal): Promise<string | undefined> {
  try {
    const args = [CLI.FLAGS.PRINT, ANTIGRAVITY.QUOTA_COMMAND, CLI.FLAGS.OUTPUT_FORMAT, OUTPUT_FORMATS.JSON];
    const raw = await executeCommand(
      CLI.COMMANDS.AGY,
      args,
      undefined,
      undefined,
      undefined,
      ANTIGRAVITY.VERSION_CHECK_TIMEOUT_MS,
      undefined,
      signal,
    );
    const parsed = parseStdoutJson(raw);
    if (parsed.kind !== "answer") return undefined;
    const lines = parsed.response
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((cells) => cells.length === 4)
      .map(([group, bucket, remaining, reset]) => `${group} ${bucket}: ${remaining} (resets ${reset})`);
    return lines.length > 0 ? lines.join("; ") : undefined;
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
}

function fromStdoutPlain(raw: string): string | null {
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

function buildUsageStats(
  usage: AgyStdoutUsage | undefined,
  model: string,
  durationMs: number,
  fellBack: boolean,
): UsageStats | undefined {
  if (!usage) return undefined;
  return {
    provider: "antigravity",
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedTokens: usage.cache_read_tokens,
    thinkingTokens: usage.thinking_tokens,
    durationMs,
    fellBack,
  };
}

// Our own messages quote agy output (partials, action names), so they must never trigger recovery.
function isTerminalOwnError(message: string): boolean {
  return isTruncatedAnswerError(message) || message.startsWith(ERROR_MESSAGES.DENIED_WITHOUT_ANSWER);
}

function isRateLimitError(message: string): boolean {
  if (isTerminalOwnError(message)) return false;
  const lower = message.toLowerCase();
  return ANTIGRAVITY.RATE_LIMIT_SIGNALS.some((s) => lower.includes(s));
}

// ADR-117 makes JSON error envelopes visible here without changing recovery matching.
export function isModelUnavailableError(message: string): boolean {
  if (isTerminalOwnError(message)) return false;
  const lower = message.toLowerCase();
  return ANTIGRAVITY.MODEL_UNAVAILABLE_SIGNALS.some((s) => lower.includes(s));
}

// Keeps the classification fields whole, bounds short_error, and drops error_id (an opaque id can contain "429").
export function findAgyErrorLine(stderr: string): string | undefined {
  const prefix = ANTIGRAVITY.STRUCTURED_ERROR_PREFIX;
  const line = stderr
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(prefix))
    ?.trim();
  if (!line) return undefined;
  try {
    const { status, code, http_status, retryable, error_id, short_error } = JSON.parse(line.slice(prefix.length));
    if (error_id !== undefined)
      Logger.warn(`antigravity: agy error_id ${JSON.stringify(String(error_id).slice(0, 80))}`);
    const shortError = typeof short_error === "string" ? short_error.slice(0, 300) : undefined;
    return `${prefix} ${JSON.stringify({ status, code, http_status, retryable, short_error: shortError })}`;
  } catch {
    return `${prefix} (unparseable)`;
  }
}

export function isTruncatedAnswerError(message: string): boolean {
  return message.startsWith(ERROR_MESSAGES.TRUNCATED);
}

// Invalid explicit effort falls back to default behavior instead of reaching agy.
export function resolveExplicitEffort(): string | undefined {
  const raw = process.env[ANTIGRAVITY.EFFORT_ENV_VAR]?.trim().toLowerCase();
  if (!raw) return undefined;
  if ((ANTIGRAVITY.VALID_EFFORTS as readonly string[]).includes(raw)) return raw;
  Logger.warn(
    `antigravity: ignoring invalid ${ANTIGRAVITY.EFFORT_ENV_VAR}="${raw}" (valid: ${ANTIGRAVITY.VALID_EFFORTS.join(", ")}).`,
  );
  return undefined;
}

// llm-mcp always passes its resolved default, so only value equality is observable.
function isOwnDefaultModel(model: string): boolean {
  return model === MODELS.DEFAULT || model === MODELS.FALLBACK;
}

type ModelSource = "options" | "env" | "default";

function modelUnavailableMessage(model: string, detail: string, source: ModelSource, explicitEffort?: string): string {
  const firstLine = detail.split("\n")[0]?.trim() || detail.trim();
  // A configured effort can be the rejected half of the model selection.
  const remediation = explicitEffort
    ? `Your ${ANTIGRAVITY.EFFORT_ENV_VAR}="${explicitEffort}" may not be supported for this model — try unsetting it, or adjust the model.`
    : source === "options"
      ? "Pass a valid model (or omit it to use the default)."
      : source === "env"
        ? "Update or unset ASK_ANTIGRAVITY_MODEL accordingly."
        : "This is ask-llm's built-in default — please report it via the ask-llm repo.";
  return (
    `Antigravity (agy) rejected model "${model}" (${firstLine}). ` +
    `Run \`agy models\` for valid slugs — agy >=1.1.5 expects a base slug (e.g. "${MODELS.DEFAULT}") ` +
    `with the effort tier set separately via ASK_ANTIGRAVITY_EFFORT (low|medium|high). ${remediation}`
  );
}

export async function executeAntigravityCLI(options: AntigravityExecutorOptions): Promise<AntigravityExecutorResult> {
  if (process.env[ANTIGRAVITY.ALLOW_UNISOLATED_ENV_VAR] !== "1") {
    throw new Error(ERROR_MESSAGES.UNISOLATED_REFUSED);
  }
  Logger.warn(
    "Antigravity (agy): ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1 permits execution, but read-only isolation is not guaranteed; agy may modify files, run shell commands, and access the network.",
  );
  const agyVersion = await assertSupportedAgyVersion(options.signal);
  const disableSlashCommands = isVersionAtLeast(agyVersion, ANTIGRAVITY.SLASH_COMMANDS_FLAG_MIN_VERSION);
  const sandbox = process.env[ANTIGRAVITY.SANDBOX_ENV_VAR] !== "0";
  const timeoutMs = resolveTimeoutMs(ANTIGRAVITY.TIMEOUT_ENV_VAR, ANTIGRAVITY.DEFAULT_TIMEOUT_MS);
  // Keep agy expiry before process timeout to detect exit-0 partial answers (ADR-162).
  const agyTimeoutSec = timeoutMs > 6000 ? Math.round(timeoutMs / 1000) - 5 : Math.max(1, Math.round(timeoutMs / 1000));
  const detectPrintTimeoutTruncation = isVersionAtLeast(
    agyVersion,
    ANTIGRAVITY.PRINT_TIMEOUT_SUCCESS_TRUNCATION_MIN_VERSION,
  );

  const fullPrompt = `${READ_ONLY_PREAMBLE}\n\n${options.prompt}`;
  const commandLogging = options.readOnly ? { sensitiveValues: [fullPrompt] } : undefined;
  if (fullPrompt.length > EXECUTION.STDIN_THRESHOLD_BYTES) {
    // agy -p still risks ARG_MAX for large prompts (spec §10.1).
    Logger.warn(
      `antigravity: prompt is ${fullPrompt.length} bytes (> ${EXECUTION.STDIN_THRESHOLD_BYTES}); agy -p passes it as an argv arg, which may hit ARG_MAX. See spec §10.1.`,
    );
  }

  const primaryModel = options.model?.trim() || process.env[ANTIGRAVITY.MODEL_ENV_VAR]?.trim() || MODELS.DEFAULT;
  const modelSource: ModelSource = options.model?.trim()
    ? "options"
    : process.env[ANTIGRAVITY.MODEL_ENV_VAR]?.trim()
      ? "env"
      : "default";
  const explicitEffort = resolveExplicitEffort();
  // Implicit effort is safe only for shipped base slugs; explicit effort always wins.
  const effortFor = (model: string | undefined): string | undefined => {
    if (explicitEffort) return explicitEffort;
    if (!model || isOwnDefaultModel(model)) return ANTIGRAVITY.DEFAULT_EFFORT;
    return undefined;
  };

  const rateLimitedError = async (): Promise<Error> => {
    const quota = isVersionAtLeast(agyVersion, ANTIGRAVITY.QUOTA_COMMAND_MIN_VERSION)
      ? await describeQuota(options.signal)
      : undefined;
    return new Error(
      quota ? `${ERROR_MESSAGES.RATE_LIMITED} Current agy quota: ${quota}` : ERROR_MESSAGES.RATE_LIMITED,
    );
  };

  const runWithModel = async (model: string | undefined, fellBack: boolean): Promise<AntigravityExecutorResult> => {
    const args = buildArgs(
      fullPrompt,
      options.includeDirs,
      agyTimeoutSec,
      sandbox,
      model,
      options.readOnly,
      effortFor(model),
      disableSlashCommands,
    );
    const startedAt = Date.now();
    const stderrChunks: string[] = [];
    const raw = await executeCommand(
      CLI.COMMANDS.AGY,
      args,
      undefined,
      (chunk) => {
        stderrChunks.push(chunk);
      },
      undefined,
      timeoutMs,
      commandLogging,
      options.signal,
    ).catch((error: unknown) => {
      // The shared sanitizer keeps only 3 stderr lines, which can drop agy's AGY_ERROR line (#335).
      // Timeouts and cancellations keep their own error; AGY_ERROR describes only agy's exit.
      if (!(error instanceof Error) || options.signal?.aborted || error.message.startsWith("Command timed out")) {
        throw error;
      }
      const agyError = findAgyErrorLine(stderrChunks.join(""));
      if (agyError) {
        // Drop the raw line the sanitizer may have kept so only the compacted fields are classified.
        const rest = error.message
          .split("\n")
          .filter((line) => !line.trimStart().startsWith(ANTIGRAVITY.STRUCTURED_ERROR_PREFIX))
          .join("\n");
        throw new Error(`${agyError}\n${rest}`);
      }
      throw error;
    });
    const durationMs = Date.now() - startedAt;
    const reportedModel = model ?? MODELS.AGY_DEFAULT_LABEL;
    const stderr = stderrChunks.join("");
    const parsed = parseStdoutJson(raw);
    const answerText =
      parsed.kind === "answer" ? parsed.response : parsed.kind === "not-json" ? fromStdoutPlain(raw) : undefined;
    const truncated =
      detectPrintTimeoutTruncation &&
      (isPrintTimeoutTruncation(stderr) || (parsed.kind !== "not-json" && parsed.truncated));
    if (truncated) {
      throw new Error(
        truncatedAnswerMessage(
          timeoutMs,
          answerText ?? undefined,
          parsed.kind === "not-json" ? undefined : parsed.deniedNotice,
        ),
      );
    }

    if (parsed.kind === "answer") {
      Logger.debug("antigravity: response from stdout-json");
      return {
        response: appendDeniedNotice(parsed.response, parsed.deniedNotice),
        model: reportedModel,
        sessionId: undefined,
        usage: buildUsageStats(parsed.usage, reportedModel, durationMs, fellBack),
      };
    }
    if (parsed.kind === "not-json") {
      const plain = fromStdoutPlain(raw);
      if (plain) {
        Logger.debug("antigravity: response from stdout-plain");
        return { response: plain, model: reportedModel, sessionId: undefined, usage: undefined };
      }
    }
    if (parsed.kind === "envelope-without-answer" && parsed.deniedNotice) {
      throw new Error(`${ERROR_MESSAGES.DENIED_WITHOUT_ANSWER} ${parsed.deniedNotice}`);
    }
    // agy exited cleanly but produced no readable answer anywhere.
    throw new Error(ERROR_MESSAGES.NO_OUTPUT);
  };

  // Recovery is bounded to one model-less attempt.
  const retryModelless = async (
    rejectedModel: string,
    rejectedSource: ModelSource,
  ): Promise<AntigravityExecutorResult> => {
    Logger.warn(
      `Antigravity rejected model "${rejectedModel}" (slug drift?). Retrying once without an explicit model.`,
    );
    try {
      return await runWithModel(undefined, true);
    } catch (retryError) {
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
      if (isTruncatedAnswerError(retryMessage)) throw retryError;
      if (isModelUnavailableError(retryMessage)) {
        throw new Error(modelUnavailableMessage(rejectedModel, retryMessage, rejectedSource, explicitEffort));
      }
      if (isRateLimitError(retryMessage)) throw await rateLimitedError();
      throw retryError;
    }
  };

  try {
    return await runWithModel(primaryModel, false);
  } catch (error) {
    if (options.singleAttempt) throw error;
    const message = error instanceof Error ? error.message : String(error);
    // Truncation embeds a bounded preview; classify it before recovery tokens in that preview.
    if (isTruncatedAnswerError(message)) throw error;
    if (isModelUnavailableError(message)) {
      // Never silently discard a custom model pin.
      if (!isOwnDefaultModel(primaryModel)) {
        throw new Error(modelUnavailableMessage(primaryModel, message, modelSource, explicitEffort));
      }
      return await retryModelless(primaryModel, modelSource);
    }
    if (!isRateLimitError(message)) {
      // A different model cannot repair spawn, auth, NO_OUTPUT, or timeout failures.
      throw error;
    }
    // Retry subscription rate limits once on Flash unless it was already selected.
    if (primaryModel === MODELS.FALLBACK) {
      throw await rateLimitedError();
    }
    Logger.warn(`Antigravity rate limited on "${primaryModel}". Falling back to "${MODELS.FALLBACK}".`);
    try {
      return await runWithModel(MODELS.FALLBACK, true);
    } catch (fallbackError) {
      const fbMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      if (isTruncatedAnswerError(fbMessage)) throw fallbackError;
      // Preserve non-quota fallback failures instead of masking them.
      if (isRateLimitError(fbMessage)) throw await rateLimitedError();
      // The executor-selected fallback gets the same bounded recovery.
      if (isModelUnavailableError(fbMessage)) return await retryModelless(MODELS.FALLBACK, "default");
      throw fallbackError;
    }
  }
}
