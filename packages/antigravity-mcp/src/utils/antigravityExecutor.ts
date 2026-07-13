import { EXECUTION, executeCommand, Logger, resolveTimeoutMs } from "@ask-llm/shared";
import { ANTIGRAVITY, CLI, ERROR_MESSAGES, MODELS, READ_ONLY_PREAMBLE } from "../constants.js";
import { withAntigravityInvocationLock } from "./invocationLock.js";
import { defaultBaseDir, readLatestTranscript, snapshotTranscriptState } from "./transcriptReader.js";

export interface AntigravityExecutorOptions {
  prompt: string;
  includeDirs?: string[];
  // agy model display name (see `agy models`), e.g. "Gemini 3.1 Pro (High)".
  // Passed via `--model` (works under -p, unlike the short `-m` flag which hangs).
  // Resolves to ASK_ANTIGRAVITY_MODEL, then MODELS.DEFAULT, when omitted; on a
  // rate limit the executor retries once on MODELS.FALLBACK.
  model?: string;
  // Accepted for orchestrator ExecutorFn compatibility but ignored: agy -p can't
  // resume by id (no capturable conversation id, antigravity-cli #7).
  sessionId?: string;
  readOnly?: boolean;
  onProgress?: (newOutput: string) => void;
}

export interface AntigravityExecutorResult {
  response: string;
  model: string;
  sessionId: undefined;
  usage: undefined;
  transcriptPath?: string;
}

// Serialize all agy invocations in-process. Concurrent `agy -p` runs race on the
// shared cache/last_conversations.json and the newest-brain-dir heuristic, which
// would cross-wire responses. This is a correctness lock, not perf tuning (spec §6).
let mutexChain: Promise<unknown> = Promise.resolve();
function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutexChain.then(fn, fn);
  mutexChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function buildArgs(
  prompt: string,
  includeDirs: string[] | undefined,
  timeoutSec: number,
  sandbox: boolean,
  model: string | undefined,
  readOnly = false,
): string[] {
  const args: string[] = [CLI.FLAGS.PRINT, prompt];
  if (includeDirs?.length) {
    for (const dir of includeDirs) args.push(CLI.FLAGS.ADD_DIR, dir);
  }
  if (model) args.push(CLI.FLAGS.MODEL, model);
  args.push(CLI.FLAGS.PRINT_TIMEOUT, `${timeoutSec}s`);
  if (readOnly) {
    args.push(CLI.FLAGS.MODE, CLI.FLAGS.PLAN, CLI.FLAGS.SANDBOX);
  } else {
    args.push(CLI.FLAGS.SKIP_PERMISSIONS);
    if (sandbox) args.push(CLI.FLAGS.SANDBOX);
  }
  return args;
}

// Ordered response sources — first non-null wins. The stdout paths are
// future-proofing for when upstream fixes the empty-stdout bug (#27466) or adds
// JSON output; today they return null and the transcript scraper supplies the answer.
function fromStdoutJson(raw: string): string | null {
  const t = raw.trim();
  if (!t.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(t) as { response?: unknown };
    return typeof parsed.response === "string" && parsed.response.length > 0 ? parsed.response : null;
  } catch {
    return null;
  }
}

function fromStdoutPlain(raw: string): string | null {
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return ANTIGRAVITY.RATE_LIMIT_SIGNALS.some((s) => lower.includes(s));
}

export async function executeAntigravityCLI(options: AntigravityExecutorOptions): Promise<AntigravityExecutorResult> {
  const baseDir = defaultBaseDir();
  const sandbox = process.env[ANTIGRAVITY.SANDBOX_ENV_VAR] !== "0";
  const timeoutMs = resolveTimeoutMs(ANTIGRAVITY.TIMEOUT_ENV_VAR, ANTIGRAVITY.DEFAULT_TIMEOUT_MS);
  const lockLeaseDurationMs = timeoutMs * 2 + 30_000;
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

  // One agy invocation with a specific model. Resolves to the parsed answer or
  // throws (rate limit, spawn error, or NO_OUTPUT). Each call stamps its own
  // startedAt so the transcript scraper reads *this* run's response, not a prior
  // (rate-limited, transcript-less) attempt.
  const runWithModel = async (model: string): Promise<AntigravityExecutorResult> => {
    const args = buildArgs(fullPrompt, options.includeDirs, agyTimeoutSec, sandbox, model, options.readOnly);
    const transcriptSnapshot = snapshotTranscriptState(baseDir);
    const startedAt = Date.now();
    const raw = await executeCommand(
      CLI.COMMANDS.AGY,
      args,
      options.onProgress,
      undefined,
      undefined,
      timeoutMs,
      commandLogging,
    );

    // First non-null wins. Order matters: structured stdout JSON (if agy ever adds
    // it, #27466) is unambiguous; the transcript is the authoritative record; raw
    // stdout text is LAST because agy may print banners/progress/auth lines that
    // aren't the answer, and those must never preempt the transcript (#153 review).
    const sources: Array<{ label: string; get: () => { response: string; transcriptPath?: string } | null }> = [
      {
        label: "stdout-json",
        get: () => {
          const response = fromStdoutJson(raw);
          return response ? { response } : null;
        },
      },
      {
        label: "transcript",
        get: () => {
          const transcript = readLatestTranscript(startedAt, transcriptSnapshot);
          return transcript ? { response: transcript.response, transcriptPath: transcript.path } : null;
        },
      },
      {
        label: "stdout-plain",
        get: () => {
          const response = fromStdoutPlain(raw);
          return response ? { response } : null;
        },
      },
    ];
    for (const source of sources) {
      const result = source.get();
      if (result !== null) {
        Logger.debug(`antigravity: response from ${source.label}`);
        return {
          response: result.response,
          model,
          sessionId: undefined,
          usage: undefined,
          ...(result.transcriptPath ? { transcriptPath: result.transcriptPath } : {}),
        };
      }
    }
    // agy exited cleanly but produced no readable answer anywhere.
    throw new Error(ERROR_MESSAGES.NO_OUTPUT);
  };

  return withMutex(() =>
    withAntigravityInvocationLock(
      baseDir,
      async () => {
        try {
          return await runWithModel(primaryModel);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!isRateLimitError(message)) {
            // not-found / spawn / NO_OUTPUT — already actionable, and a different model
            // wouldn't help (auth / not-installed fail identically on every model).
            throw error;
          }
          // Primary hit a subscription rate limit. Retry once on the cheaper Flash
          // tier, unless we were already on it (or the caller pinned a model equal to
          // the fallback) — in which case there is nothing left to fall back to.
          if (primaryModel === MODELS.FALLBACK) {
            throw new Error(ERROR_MESSAGES.RATE_LIMITED);
          }
          Logger.warn(`Antigravity rate limited on "${primaryModel}". Falling back to "${MODELS.FALLBACK}".`);
          try {
            return await runWithModel(MODELS.FALLBACK);
          } catch (fallbackError) {
            const fbMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            // Both tiers throttled → the actionable quota message. A non-rate-limit
            // fallback failure (timeout, crash) is surfaced as-is, not masked.
            if (isRateLimitError(fbMessage)) throw new Error(ERROR_MESSAGES.RATE_LIMITED);
            throw fallbackError;
          }
        }
      },
      { leaseDurationMs: lockLeaseDurationMs },
    ),
  );
}
