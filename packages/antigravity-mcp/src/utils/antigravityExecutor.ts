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
    args.push(CLI.FLAGS.SKIP_PERMISSIONS);
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
}

type StdoutParse =
  | { kind: "answer"; response: string; usage: AgyStdoutUsage | undefined }
  | { kind: "envelope-without-answer" }
  | { kind: "not-json" };

// Parsed JSON envelopes never fall through to raw stdout; see ADR-141.
function parseStdoutJson(raw: string): StdoutParse {
  const t = raw.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return { kind: "not-json" };
  let parsed: AgyStdoutJson;
  try {
    parsed = JSON.parse(t) as AgyStdoutJson;
  } catch {
    // JSON-looking but unparsable output is a corrupt envelope, not legacy text.
    return { kind: "envelope-without-answer" };
  }
  if (typeof parsed.response !== "string") return { kind: "envelope-without-answer" };
  // Preserve the transcript-era response bytes by removing agy's envelope-only trailing newline.
  const response = parsed.response.trimEnd();
  if (response.length === 0) return { kind: "envelope-without-answer" };
  const usage = parsed.usage && typeof parsed.usage === "object" ? parsed.usage : undefined;
  return { kind: "answer", response, usage };
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

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return ANTIGRAVITY.RATE_LIMIT_SIGNALS.some((s) => lower.includes(s));
}

// ADR-117 makes JSON error envelopes visible here without changing recovery matching.
export function isModelUnavailableError(message: string): boolean {
  const lower = message.toLowerCase();
  return ANTIGRAVITY.MODEL_UNAVAILABLE_SIGNALS.some((s) => lower.includes(s));
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
  const agyVersion = await assertSupportedAgyVersion(options.signal);
  const disableSlashCommands = isVersionAtLeast(agyVersion, ANTIGRAVITY.SLASH_COMMANDS_FLAG_MIN_VERSION);
  const sandbox = process.env[ANTIGRAVITY.SANDBOX_ENV_VAR] !== "0";
  const timeoutMs = resolveTimeoutMs(ANTIGRAVITY.TIMEOUT_ENV_VAR, ANTIGRAVITY.DEFAULT_TIMEOUT_MS);
  // Tell agy to wait slightly less than our hard process timeout so agy's own
  // --print-timeout fires first with a cleaner message when the model is slow.
  // For very small configured timeouts (<=6s), don't subtract — otherwise agy's
  // deadline could invert past the process timeout (or clamp to a near-instant 1s).
  const agyTimeoutSec = timeoutMs > 6000 ? Math.round(timeoutMs / 1000) - 5 : Math.max(1, Math.round(timeoutMs / 1000));

  const fullPrompt = `${READ_ONLY_PREAMBLE}\n\n${options.prompt}`;
  const commandLogging = options.readOnly ? { sensitiveValues: [fullPrompt] } : undefined;
  if (fullPrompt.length > EXECUTION.STDIN_THRESHOLD_BYTES) {
    // v1 passes the prompt as a -p argument; very large prompts risk the ARG_MAX
    // ceiling. stdin/temp-file handling is a documented open item (spec §10.1).
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
    const raw = await executeCommand(
      CLI.COMMANDS.AGY,
      args,
      undefined,
      undefined,
      undefined,
      timeoutMs,
      commandLogging,
      options.signal,
    );
    const durationMs = Date.now() - startedAt;
    const reportedModel = model ?? MODELS.AGY_DEFAULT_LABEL;

    const parsed = parseStdoutJson(raw);
    if (parsed.kind === "answer") {
      Logger.debug("antigravity: response from stdout-json");
      return {
        response: parsed.response,
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
      if (isModelUnavailableError(retryMessage)) {
        throw new Error(modelUnavailableMessage(rejectedModel, retryMessage, rejectedSource, explicitEffort));
      }
      if (isRateLimitError(retryMessage)) throw new Error(ERROR_MESSAGES.RATE_LIMITED);
      throw retryError;
    }
  };

  try {
    return await runWithModel(primaryModel, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
      throw new Error(ERROR_MESSAGES.RATE_LIMITED);
    }
    Logger.warn(`Antigravity rate limited on "${primaryModel}". Falling back to "${MODELS.FALLBACK}".`);
    try {
      return await runWithModel(MODELS.FALLBACK, true);
    } catch (fallbackError) {
      const fbMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      // Preserve non-quota fallback failures instead of masking them.
      if (isRateLimitError(fbMessage)) throw new Error(ERROR_MESSAGES.RATE_LIMITED);
      // The executor-selected fallback gets the same bounded recovery.
      if (isModelUnavailableError(fbMessage)) return await retryModelless(MODELS.FALLBACK, "default");
      throw fallbackError;
    }
  }
}
