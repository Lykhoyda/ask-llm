import { EXECUTION, executeCommand, Logger, resolveTimeoutMs, type UsageStats } from "@ask-llm/shared";
import {
  ANTIGRAVITY,
  ANTIGRAVITY_REASONING_EFFORTS,
  CLI,
  ERROR_MESSAGES,
  MODELS,
  OUTPUT_FORMATS,
  READ_ONLY_PREAMBLE,
  SESSION_SETTINGS_OVERLAY,
} from "../constants.js";
import { assertSupportedAgyVersion, isVersionAtLeast } from "./agyVersion.js";

export { assessAgyVersion, isVersionAtLeast, probeAgySupport } from "./agyVersion.js";
export { ANTIGRAVITY_REASONING_EFFORTS } from "../constants.js";
export const DOCTOR_QUOTA_MIN_VERSION = ANTIGRAVITY.QUOTA_COMMAND_MIN_VERSION;

type AntigravityReasoningEffort = (typeof ANTIGRAVITY_REASONING_EFFORTS)[number];

export interface AntigravityExecutorOptions {
  prompt: string;
  includeDirs?: string[];
  // agy model slug; legacy effort-carrying display strings remain compatible.
  model?: string;
  // The unified tool marks the caller's exact pin. Machine also passes synthesized models.
  modelFromCall?: boolean;
  reasoningEffort?: AntigravityReasoningEffort;
  // Resume the top-level conversation_id returned by agy JSON stdout.
  sessionId?: string;
  readOnly?: boolean;
  onProgress?: (newOutput: string) => void;
  signal?: AbortSignal;
  singleAttempt?: boolean;
}

export interface AntigravityExecutorResult {
  response: string;
  model: string;
  sessionId: string | undefined;
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
  sessionId?: string,
): string[] {
  const args: string[] = [CLI.FLAGS.PRINT, prompt];
  if (includeDirs?.length) {
    for (const dir of includeDirs) args.push(CLI.FLAGS.ADD_DIR, dir);
  }
  if (sessionId?.trim()) args.push(CLI.FLAGS.CONVERSATION, sessionId.trim());
  if (model) args.push(CLI.FLAGS.MODEL, model);
  if (effort) args.push(CLI.FLAGS.EFFORT, effort);
  args.push(CLI.FLAGS.PRINT_TIMEOUT, `${timeoutSec}s`);
  args.push(CLI.FLAGS.OUTPUT_FORMAT, OUTPUT_FORMATS.JSON);
  if (disableSlashCommands) args.push(CLI.FLAGS.DISABLE_SLASH_COMMANDS);
  // agy ignores --mode plan beside --disable-slash-commands, so read-only only forces --sandbox.
  if (readOnly || sandbox) args.push(CLI.FLAGS.SANDBOX);
  // Every spawn (primary and each retry) carries the enforced overlay (ADR-194).
  args.push(CLI.FLAGS.SETTINGS, SESSION_SETTINGS_OVERLAY);
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
  conversation_id?: unknown;
  response?: unknown;
  usage?: AgyStdoutUsage;
  finished_reason?: unknown;
  truncated?: unknown;
  denied_actions?: unknown;
  status?: unknown;
}

type IncompleteReason = "print_timeout" | "interrupted" | "error";

interface AgyEnvelopeMeta {
  incompleteReason: IncompleteReason | undefined;
  deniedNotice: string | undefined;
}

type StdoutParse =
  | (AgyEnvelopeMeta & {
      kind: "answer";
      response: string;
      sessionId: string | undefined;
      usage: AgyStdoutUsage | undefined;
    })
  | (AgyEnvelopeMeta & { kind: "envelope-without-answer" })
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

function envelopeIncompleteReason(
  parsed: AgyStdoutJson,
  detectLegacyTruncation: boolean,
): IncompleteReason | undefined {
  const reason = parsed.finished_reason;
  if (reason === "print_timeout" || reason === "interrupted" || reason === "error") return reason;
  if (detectLegacyTruncation && envelopeLooksTruncated(parsed)) return "print_timeout";
  return undefined;
}

function previewPartial(partial: string | undefined): string | undefined {
  const t = partial?.trim();
  if (!t) return undefined;
  if (t.length <= ANTIGRAVITY.PARTIAL_OUTPUT_PREVIEW_CHARS) return t;
  return `${t.slice(0, ANTIGRAVITY.PARTIAL_OUTPUT_PREVIEW_CHARS)}... (truncated)`;
}

const INCOMPLETE_ANSWER_MESSAGES = {
  print_timeout: ERROR_MESSAGES.TRUNCATED,
  interrupted: ERROR_MESSAGES.TURN_INTERRUPTED,
  error: ERROR_MESSAGES.TURN_FAILED,
};

function incompleteAnswerMessage(
  reason: IncompleteReason,
  timeoutMs: number,
  partial?: string,
  deniedNotice?: string,
): string {
  const parts: string[] = [INCOMPLETE_ANSWER_MESSAGES[reason]];
  if (reason === "print_timeout") {
    parts.push(`Increase ${ANTIGRAVITY.TIMEOUT_ENV_VAR} (current: ${timeoutMs}ms) or shorten the prompt.`);
  }
  if (deniedNotice) parts.push(deniedNotice);
  const preview = previewPartial(partial);
  if (preview) parts.push("Partial output follows:", preview);
  return parts.join(" ");
}

function appendDeniedNotice(response: string, notice: string | undefined): string {
  return notice ? `${response}\n\n[${notice}]` : response;
}

// Parsed JSON envelopes never fall through to raw stdout; see ADR-141.
function parseStdoutJson(raw: string, detectLegacyTruncation: boolean): StdoutParse {
  const t = raw.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return { kind: "not-json" };
  let parsed: AgyStdoutJson;
  try {
    parsed = JSON.parse(t) as AgyStdoutJson;
  } catch {
    // JSON-looking but unparsable output is a corrupt envelope, not legacy text.
    return { kind: "envelope-without-answer", incompleteReason: undefined, deniedNotice: undefined };
  }
  const meta = {
    incompleteReason: envelopeIncompleteReason(parsed, detectLegacyTruncation),
    deniedNotice: formatDeniedActions(parsed.denied_actions),
  };
  if (typeof parsed.response !== "string") return { kind: "envelope-without-answer", ...meta };
  // Preserve the transcript-era response bytes by removing agy's envelope-only trailing newline.
  const response = parsed.response.trimEnd();
  if (response.length === 0) return { kind: "envelope-without-answer", ...meta };
  const usage = parsed.usage && typeof parsed.usage === "object" ? parsed.usage : undefined;
  const sessionId = typeof parsed.conversation_id === "string" ? parsed.conversation_id.trim() || undefined : undefined;
  return { kind: "answer", response, sessionId, usage, ...meta };
}

// Sandboxed /quota answered without a turn or quota use on agy 1.2.13 (https://github.com/Lykhoyda/ask-llm/pull/366).
// Both doctor --live and rate-limit recovery gate on QUOTA_COMMAND_MIN_VERSION (ADR-194).
export async function probeAntigravityQuota(signal?: AbortSignal): Promise<string> {
  const args = [
    CLI.FLAGS.PRINT,
    ANTIGRAVITY.QUOTA_COMMAND,
    CLI.FLAGS.OUTPUT_FORMAT,
    OUTPUT_FORMATS.JSON,
    CLI.FLAGS.SANDBOX,
    CLI.FLAGS.SETTINGS,
    SESSION_SETTINGS_OVERLAY,
  ];
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
  const parsed = parseStdoutJson(raw, true);
  if (parsed.kind !== "answer") throw new Error("agy /quota returned no quota answer");
  if (parsed.incompleteReason === "print_timeout") throw new Error("agy /quota returned truncated output");
  if (parsed.incompleteReason) throw new Error(`agy /quota: ${INCOMPLETE_ANSWER_MESSAGES[parsed.incompleteReason]}`);
  const lines = parsed.response
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((cells) => cells.length === 4)
    .map(([group, bucket, remaining, reset]) => `${group} ${bucket}: ${remaining} (resets ${reset})`);
  if (lines.length === 0) throw new Error("agy /quota returned no quota rows");
  return lines.join("; ");
}

async function describeQuota(signal?: AbortSignal): Promise<string | undefined> {
  try {
    return await probeAntigravityQuota(signal);
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
  return (
    isTruncatedAnswerError(message) ||
    message.startsWith(ERROR_MESSAGES.TURN_INTERRUPTED) ||
    message.startsWith(ERROR_MESSAGES.TURN_FAILED) ||
    message.startsWith(ERROR_MESSAGES.DENIED_WITHOUT_ANSWER)
  );
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

export function isAntigravityReasoningEffort(value: string): value is AntigravityReasoningEffort {
  return ANTIGRAVITY_REASONING_EFFORTS.some((effort) => effort === value);
}

export function isAntigravityTieredModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  // Recognize catalog IDs and legacy display names. Custom slugs are validated by agy.
  const catalogSlug = /^(?:gemini-\d|claude-(?:opus|sonnet|haiku)-\d)/.test(normalized);
  return ANTIGRAVITY_REASONING_EFFORTS.some(
    (effort) => (catalogSlug && normalized.endsWith(`-${effort}`)) || normalized.endsWith(` (${effort})`),
  );
}

// Invalid environment effort falls back to default behavior instead of reaching agy.
export function resolveExplicitEffort(): AntigravityReasoningEffort | undefined {
  const raw = process.env[ANTIGRAVITY.EFFORT_ENV_VAR]?.trim().toLowerCase();
  if (!raw) return undefined;
  if (isAntigravityReasoningEffort(raw)) return raw;
  Logger.warn(
    `antigravity: ignoring invalid ${ANTIGRAVITY.EFFORT_ENV_VAR}="${raw}" (valid: ${ANTIGRAVITY_REASONING_EFFORTS.join(", ")}).`,
  );
  return undefined;
}

function isOwnDefaultModel(model: string): boolean {
  return model === MODELS.DEFAULT || model === MODELS.FALLBACK;
}

type ModelSource = "options" | "env" | "default";

function modelUnavailableMessage(model: string, detail: string, source: ModelSource, effortSetting?: string): string {
  const firstLine = detail.split("\n")[0]?.trim() || detail.trim();
  // A configured effort can be the rejected half of the model selection.
  const remediation = effortSetting
    ? `${effortSetting} may not be supported for this model. Omit or change the effort, or choose a compatible model.`
    : source === "options"
      ? "Pass a valid model (or omit it to use the default)."
      : source === "env"
        ? "Update or unset ASK_ANTIGRAVITY_MODEL accordingly."
        : "Report a rejected built-in model in the ask-llm repository.";
  return (
    `Antigravity (agy) rejected model "${model}" (${firstLine}). ` +
    `Run \`agy models\` for valid slugs and tiers. Use a base slug (e.g. "${MODELS.DEFAULT}") with a separate effort, ` +
    `or a tiered model ID by itself. ${remediation}`
  );
}

export async function executeAntigravityCLI(options: AntigravityExecutorOptions): Promise<AntigravityExecutorResult> {
  if (process.env[ANTIGRAVITY.ALLOW_UNISOLATED_ENV_VAR] !== "1") {
    throw new Error(ERROR_MESSAGES.UNISOLATED_REFUSED);
  }

  const optionModel = options.model?.trim();
  if (options.modelFromCall && !optionModel) throw new Error("Antigravity model must not be blank.");
  if (options.reasoningEffort !== undefined && !isAntigravityReasoningEffort(options.reasoningEffort)) {
    throw new Error(`Antigravity reasoningEffort must be one of: ${ANTIGRAVITY_REASONING_EFFORTS.join(", ")}.`);
  }
  const envModel = process.env[ANTIGRAVITY.MODEL_ENV_VAR]?.trim();
  const primaryModel = optionModel || envModel || MODELS.DEFAULT;
  const modelSource: ModelSource = optionModel ? "options" : envModel ? "env" : "default";
  const explicitEffort = options.reasoningEffort ?? resolveExplicitEffort();
  const effortSettingName = options.reasoningEffort === undefined ? ANTIGRAVITY.EFFORT_ENV_VAR : "reasoningEffort";
  const effortSetting = explicitEffort && `${effortSettingName}="${explicitEffort}"`;
  if (effortSetting && isAntigravityTieredModel(primaryModel)) {
    throw new Error(
      `Antigravity model "${primaryModel}" already includes an effort tier. Omit ${effortSettingName} or use a base model slug.`,
    );
  }
  const hasCallSelection = options.modelFromCall || options.reasoningEffort !== undefined;

  Logger.warn(
    "Antigravity (agy): ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1 permits execution, but read-only isolation is not guaranteed; agy may modify files, run shell commands, and access the network.",
  );
  const agyVersion = await assertSupportedAgyVersion(options.signal);
  const disableSlashCommands = isVersionAtLeast(agyVersion, ANTIGRAVITY.SLASH_COMMANDS_FLAG_MIN_VERSION);
  const sandbox = process.env[ANTIGRAVITY.SANDBOX_ENV_VAR] !== "0";
  const timeoutMs = resolveTimeoutMs(ANTIGRAVITY.TIMEOUT_ENV_VAR, ANTIGRAVITY.DEFAULT_TIMEOUT_MS);
  // Keep agy expiry before process timeout to detect exit-0 partial answers (ADR-162).
  const agyTimeoutSec = timeoutMs > 6000 ? Math.round(timeoutMs / 1000) - 5 : Math.max(1, Math.round(timeoutMs / 1000));
  const detectLegacyTruncation = isVersionAtLeast(agyVersion, ANTIGRAVITY.PRINT_TIMEOUT_SUCCESS_TRUNCATION_MIN_VERSION);

  const fullPrompt = `${READ_ONLY_PREAMBLE}\n\n${options.prompt}`;
  const commandLogging = options.readOnly ? { sensitiveValues: [fullPrompt] } : undefined;
  if (fullPrompt.length > EXECUTION.STDIN_THRESHOLD_BYTES) {
    // agy -p still risks ARG_MAX for large prompts (spec §10.1).
    Logger.warn(
      `antigravity: prompt is ${fullPrompt.length} bytes (> ${EXECUTION.STDIN_THRESHOLD_BYTES}); agy -p passes it as an argv arg, which may hit ARG_MAX. See spec §10.1.`,
    );
  }

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
      options.sessionId,
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
    const parsed = parseStdoutJson(raw, detectLegacyTruncation);
    const envelopeReason = parsed.kind === "not-json" ? undefined : parsed.incompleteReason;
    const incompleteReason =
      envelopeReason ?? (detectLegacyTruncation && isPrintTimeoutTruncation(stderr) ? "print_timeout" : undefined);
    if (incompleteReason) {
      const partial =
        parsed.kind === "answer" ? parsed.response : parsed.kind === "not-json" ? fromStdoutPlain(raw) : undefined;
      throw new Error(
        incompleteAnswerMessage(
          incompleteReason,
          timeoutMs,
          partial ?? undefined,
          parsed.kind === "not-json" ? undefined : parsed.deniedNotice,
        ),
      );
    }

    if (parsed.kind === "answer") {
      Logger.debug("antigravity: response from stdout-json");
      // agy 1.5.10 warns and starts fresh when --conversation cannot be found.
      const resetNotice =
        options.sessionId?.trim() && /^warning: conversation ".+" not found$/m.test(stderr)
          ? "agy could not find the requested conversation and started a fresh conversation."
          : undefined;
      if (resetNotice) Logger.warn(`antigravity: ${resetNotice}`);
      return {
        response: appendDeniedNotice(appendDeniedNotice(parsed.response, parsed.deniedNotice), resetNotice),
        model: reportedModel,
        sessionId: parsed.sessionId,
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
      if (isTerminalOwnError(retryMessage)) throw retryError;
      if (isModelUnavailableError(retryMessage)) {
        throw new Error(modelUnavailableMessage(rejectedModel, retryMessage, rejectedSource, effortSetting));
      }
      if (isRateLimitError(retryMessage)) throw await rateLimitedError();
      throw retryError;
    }
  };

  try {
    return await runWithModel(primaryModel, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isTerminalOwnError(message)) throw error;
    if (isModelUnavailableError(message)) {
      if (options.singleAttempt || hasCallSelection || !isOwnDefaultModel(primaryModel)) {
        throw new Error(modelUnavailableMessage(primaryModel, message, modelSource, effortSetting));
      }
      return await retryModelless(primaryModel, modelSource);
    }
    if (!isRateLimitError(message)) {
      // A different model cannot repair spawn, auth, NO_OUTPUT, or timeout failures.
      throw error;
    }
    if (options.singleAttempt) throw new Error(ERROR_MESSAGES.RATE_LIMITED);
    // Retry subscription rate limits once on the fallback model unless it was already selected.
    if (primaryModel === MODELS.FALLBACK) {
      throw await rateLimitedError();
    }
    Logger.warn(`Antigravity rate limited on "${primaryModel}". Falling back to "${MODELS.FALLBACK}".`);
    try {
      return await runWithModel(MODELS.FALLBACK, true);
    } catch (fallbackError) {
      const fbMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      if (isTerminalOwnError(fbMessage)) throw fallbackError;
      if (isModelUnavailableError(fbMessage)) {
        if (!hasCallSelection) return await retryModelless(MODELS.FALLBACK, "default");
        throw new Error(modelUnavailableMessage(MODELS.FALLBACK, fbMessage, "default", effortSetting));
      }
      if (isRateLimitError(fbMessage)) throw await rateLimitedError();
      throw fallbackError;
    }
  }
}
