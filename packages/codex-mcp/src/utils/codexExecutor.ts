import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ChangeModeEdit,
  EXECUTION,
  executeCommand,
  formatChangeModeResponse,
  Logger,
  ResponseCache,
  resolveTimeoutMs,
  responseCache,
  summarizeChangeModeEdits,
  type UsageStats,
  validateChangeModeEdits,
} from "@ask-llm/shared";
import {
  CLI,
  CODEX_EDIT_SCHEMA,
  type CodexReasoningEffort,
  DEFAULT_REASONING_EFFORT,
  ERROR_MESSAGES,
  MODELS,
  STATUS_MESSAGES,
} from "../constants.js";

// Re-exported on the `@ask-llm/codex-mcp/executor` surface so the llm-mcp orchestrator
// can load the doctor enrichment by name (mirrors how executeCodexCLI is loaded).
// `parseCodexDoctorJson` stays internal — tests import it from "./codexDoctor.js".
export { enrichCodexDoctor } from "./codexDoctor.js";

interface CodexItemCompleted {
  type: "item.completed";
  item?: {
    type?: string;
    text?: string;
  };
}

interface CodexTurnCompleted {
  type: "turn.completed";
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    // codex rust-v0.125+ ships reasoning-token counts for reasoning models.
    // Optional + backward compatible: older codex versions
    // simply don't emit the field, so older deserializations get undefined.
    reasoning_output_tokens?: number;
  };
}

interface CodexThreadStarted {
  type: "thread.started";
  thread_id?: string;
}

// codex rust-v0.131.0+ emits turn.failed for turns that abort (quota, policy,
// deadline) without producing an agent_message; the human-readable reason is
// nested under error.message.
interface CodexTurnFailed {
  type: "turn.failed";
  error?: { message?: string };
}

interface CodexErrorEvent {
  type: "error";
  message?: string;
}

type CodexJsonLine =
  | CodexItemCompleted
  | CodexTurnCompleted
  | CodexThreadStarted
  | CodexTurnFailed
  | CodexErrorEvent
  | { type: string };

export interface CodexExecutorOptions {
  prompt: string;
  model?: string;
  // Per-call Codex Responses reasoning override. Passed through `-c
  // model_reasoning_effort=...`; omitted callers use the behavior-preserving
  // medium default rather than GPT-5.6 Sol's lighter CLI default.
  reasoningEffort?: CodexReasoningEffort;
  sessionId?: string;
  // Additional directories codex may access alongside the workspace (codex
  // `--add-dir`, repeatable) — monorepo parity with gemini's includeDirs. #59.
  includeDirs?: string[];
  // ask-codex-edit: run codex with --output-schema (read-only sandbox) so it
  // returns structured search/replace edits instead of prose. #102.
  editMode?: boolean;
  sandbox?: "read-only" | "workspace-write";
  outputSchema?: Record<string, unknown>;
  onProgress?: (newOutput: string) => void;
  // Opt-in for /codex-review and /brainstorm: try MODELS.PREFERRED first and
  // downgrade to MODELS.DEFAULT on any failure. Honored only for fresh
  // (no sessionId), non-edit calls with no explicit model. See ADR-132.
  preferred?: boolean;
  signal?: AbortSignal;
}

export interface CodexExecutorResult {
  response: string;
  threadId: string | undefined;
  usage: UsageStats | undefined;
}

function buildUsageStats(
  usage: CodexTurnCompleted["usage"],
  model: string,
  durationMs: number,
  fellBack: boolean,
): UsageStats {
  return {
    provider: "codex",
    model,
    inputTokens: usage?.input_tokens,
    outputTokens: usage?.output_tokens,
    cachedTokens: usage?.cached_input_tokens,
    thinkingTokens: usage?.reasoning_output_tokens,
    durationMs,
    fellBack,
  };
}

function formatStats(usage: CodexTurnCompleted["usage"]): string {
  if (!usage) return "";
  const parts: string[] = [];
  if (usage.input_tokens != null) parts.push(`${usage.input_tokens.toLocaleString()} input tokens`);
  if (usage.output_tokens != null) parts.push(`${usage.output_tokens.toLocaleString()} output tokens`);
  // Symmetric with Gemini's "thinking tokens" footer (geminiExecutor.ts:formatStats).
  if (usage.reasoning_output_tokens != null && usage.reasoning_output_tokens > 0)
    parts.push(`${usage.reasoning_output_tokens.toLocaleString()} thinking tokens`);
  if (usage.cached_input_tokens != null && usage.cached_input_tokens > 0)
    parts.push(`${usage.cached_input_tokens.toLocaleString()} cached`);
  return parts.length > 0 ? `\n\n[Codex stats: ${parts.join(", ")}]` : "";
}

// Exported for unit testing — the exit-0 error-event path (codex emits
// {"type":"error",...} as JSONL and still exits 0) throws "Codex error
// event: <message>", which isQuotaError must classify.
export function parseCodexJsonlOutput(
  raw: string,
  model: string,
  durationMs: number,
  fellBack: boolean,
): CodexExecutorResult {
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  let lastAgentMessage: string | undefined;
  let threadId: string | undefined;
  let usage: CodexTurnCompleted["usage"];
  let lastError: string | undefined;
  let sawJsonlEvent = false;

  for (const line of lines) {
    let parsed: CodexJsonLine;
    try {
      parsed = JSON.parse(line) as CodexJsonLine;
    } catch {
      continue;
    }

    // Only object lines with a string `type` count as codex events — a bare
    // number or quoted string in plain-text output also survives JSON.parse.
    if (parsed && typeof parsed === "object" && typeof (parsed as { type?: unknown }).type === "string") {
      sawJsonlEvent = true;
    }

    if (parsed.type === "thread.started") {
      const thread = parsed as CodexThreadStarted;
      if (thread.thread_id) {
        threadId = thread.thread_id;
      }
    }

    if (parsed.type === "item.completed") {
      const item = (parsed as CodexItemCompleted).item;
      if (item?.type === "agent_message" && typeof item.text === "string" && item.text.length > 0) {
        lastAgentMessage = item.text;
      }
    }

    if (parsed.type === "turn.completed") {
      usage = (parsed as CodexTurnCompleted).usage;
    }

    if (parsed.type === "turn.failed") {
      lastError = (parsed as CodexTurnFailed).error?.message ?? JSON.stringify(parsed);
    }

    if (parsed.type === "error") {
      lastError = (parsed as CodexErrorEvent).message ?? JSON.stringify(parsed);
    }
  }

  if (lastError && !lastAgentMessage) {
    throw new Error(`Codex error event: ${lastError}`);
  }

  if (!lastAgentMessage) {
    if (sawJsonlEvent) {
      // Events parsed but no agent message: dumping the raw JSONL as the
      // "response" reads as garbage to the consuming LLM — fail actionably.
      const truncated =
        raw.length > EXECUTION.ERROR_TRUNCATE_LENGTH ? `${raw.slice(0, EXECUTION.ERROR_TRUNCATE_LENGTH)}…` : raw;
      throw new Error(
        `Codex completed without an agent message${threadId ? ` (thread ${threadId})` : ""}. ` +
          `The run ended before producing a response — retry, or resume the thread via sessionId. ` +
          `Raw JSONL (truncated):\n${truncated}`,
      );
    }
    Logger.debug("No parseable Codex JSONL events found, using raw text as the response");
    return { response: raw, threadId, usage: buildUsageStats(usage, model, durationMs, fellBack) };
  }

  return {
    response: lastAgentMessage + formatStats(usage),
    threadId,
    usage: buildUsageStats(usage, model, durationMs, fellBack),
  };
}

// Exported for unit testing — pure predicate over the error message text.
export function isQuotaError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return ERROR_MESSAGES.QUOTA_SIGNALS.some((signal) => msg.includes(signal));
}

function isArchivedSessionError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return ERROR_MESSAGES.ARCHIVED_SESSION_SIGNALS.some((signal) => msg.includes(signal));
}

function isSessionContinuityError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return ERROR_MESSAGES.SESSION_CONTINUITY_SIGNALS.some((signal) => msg.includes(signal));
}

function translateSessionContinuityError(error: unknown, sessionId?: string): Error | undefined {
  if (!sessionId) return undefined;
  if (isArchivedSessionError(error)) {
    return new Error(
      `Codex session ${sessionId} is archived. Run \`codex unarchive ${sessionId}\` to resume it, or omit sessionId to start a new thread.`,
    );
  }
  if (isSessionContinuityError(error)) {
    return new Error(
      `Codex session ${sessionId} has no persisted rollout and cannot be resumed. Start a new resumable conversation by passing \`sessionId: ""\` on its first call, then use the returned sessionId for follow-up turns.`,
    );
  }
  return undefined;
}

// Exported for unit testing — pure predicate over the error message text. True
// when the model is structurally rejected for the account type (a 400, NOT a
// quota signal), e.g. a pinned gpt-5.5-mini fallback on a ChatGPT-plan account.
// #196 / ADR-126.
export function isModelUnavailableError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return ERROR_MESSAGES.MODEL_UNAVAILABLE_SIGNALS.some((signal) => msg.includes(signal));
}

interface CodexEditItem {
  file: string;
  startLine?: number;
  oldCode: string;
  newCode: string;
  description?: string;
}

// Map codex's --output-schema JSON ({ edits: [...] }) onto ChangeModeEdit[],
// deriving the line ranges from line counts the same way parseChangeModeOutput
// does for Gemini. No regex — the schema already guarantees the shape. #102.
// Extract the first balanced top-level JSON object from a string, ignoring any
// trailing content — the executor appends a "[Codex stats: ...]" footer to the
// agent_message, and codex could emit stray prose. String-aware brace counter.
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseCodexEdits(rawJson: string): ChangeModeEdit[] {
  let parsed: { edits?: CodexEditItem[] };
  try {
    parsed = JSON.parse(extractFirstJsonObject(rawJson) ?? rawJson);
  } catch {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.edits)) return [];
  const edits: ChangeModeEdit[] = [];
  for (const item of parsed.edits) {
    if (
      !item ||
      typeof item.file !== "string" ||
      typeof item.oldCode !== "string" ||
      typeof item.newCode !== "string"
    ) {
      continue;
    }
    // Exact bytes — schema JSON carries the precise text, so do NOT trim:
    // trailing spaces / final newlines are load-bearing for exact-match apply.
    const oldCode = item.oldCode;
    const newCode = item.newCode;
    const startLine = typeof item.startLine === "number" && item.startLine > 0 ? item.startLine : 1;
    const oldLineCount = oldCode === "" ? 0 : oldCode.split("\n").length;
    const newLineCount = newCode === "" ? 0 : newCode.split("\n").length;
    edits.push({
      filename: item.file,
      oldStartLine: startLine,
      oldEndLine: startLine + (oldLineCount > 0 ? oldLineCount - 1 : 0),
      oldCode,
      newStartLine: startLine,
      newEndLine: startLine + (newLineCount > 0 ? newLineCount - 1 : 0),
      newCode,
    });
  }
  return edits;
}

// Mirror geminiExecutor.processChangeModeOutput, but the input is codex's
// schema-validated JSON (via parseCodexEdits, not a regex). v1 returns all edits
// in one response — codex-mcp has no fetch-chunk tool yet — with a summary header
// for large sets. #102.
export function processCodexEditOutput(rawJson: string): string {
  const edits = parseCodexEdits(rawJson);
  if (edits.length === 0) {
    return "Codex proposed no edits for this request.";
  }
  const validation = validateChangeModeEdits(edits);
  if (!validation.valid) {
    return `Edit validation failed:\n${validation.errors.join("\n")}`;
  }
  let result = formatChangeModeResponse(edits);
  if (edits.length > 5) {
    result = `${summarizeChangeModeEdits(edits)}\n\n${result}`;
  }
  return result;
}

function buildArgs(
  prompt: string,
  model: string,
  sessionId?: string,
  useStdin?: boolean,
  includeDirs?: string[],
  sandboxMode: "read-only" | "workspace-write" = CLI.FLAGS.SANDBOX_READ_ONLY,
  schemaPath?: string,
  reasoningEffort: CodexReasoningEffort = DEFAULT_REASONING_EFFORT,
): string[] {
  const isResume = Boolean(sessionId);
  const base: string[] = [CLI.COMMANDS.EXEC];
  if (isResume) base.push(CLI.COMMANDS.RESUME);
  base.push(CLI.FLAGS.SKIP_GIT);
  if (sessionId === undefined) base.push(CLI.FLAGS.EPHEMERAL);
  // Ignore user-side ~/.codex/config.toml (hooks, MCP servers, preferences)
  // and execpolicy .rules files so our MCP-wrapped exec stays deterministic
  // regardless of host machine codex configuration. Auth credentials in
  // CODEX_HOME are still loaded. Opt out with ASK_CODEX_LOAD_USER_CONFIG=1
  // (e.g., users with custom MCP servers registered in ~/.codex/config.toml
  // who need them available inside @ask-llm/codex-mcp invocations). See ADR-071.
  if (process.env.ASK_CODEX_LOAD_USER_CONFIG !== "1") {
    base.push(CLI.FLAGS.IGNORE_USER_CONFIG, CLI.FLAGS.IGNORE_RULES);
  }
  if (isResume) {
    base.push(CLI.FLAGS.CONFIG, `sandbox_mode="${sandboxMode}"`);
  } else {
    base.push(CLI.FLAGS.SANDBOX, sandboxMode);
  }
  base.push(CLI.FLAGS.CONFIG, `model_reasoning_effort="${reasoningEffort}"`, CLI.FLAGS.JSON, CLI.FLAGS.MODEL, model);
  if (schemaPath) base.push(CLI.FLAGS.OUTPUT_SCHEMA, schemaPath);
  if (!isResume && includeDirs?.length) {
    for (const dir of includeDirs) base.push(CLI.FLAGS.ADD_DIR, dir);
  }
  if (isResume) base.push(sessionId as string);
  if (!useStdin) base.push(prompt);
  return base;
}

export async function executeCodexCLI(options: CodexExecutorOptions): Promise<CodexExecutorResult> {
  const model = options.model || MODELS.DEFAULT;
  const reasoningEffort = options.reasoningEffort || DEFAULT_REASONING_EFFORT;
  const sessionId = options.sessionId;
  const editMode = options.editMode === true;
  const outputSchema = options.outputSchema ?? (editMode ? CODEX_EDIT_SCHEMA : undefined);
  // All ask-codex surfaces are second-opinion/proposal tools: Codex reads and
  // reasons, while the MCP client applies any resulting edits. Default every
  // path to Codex's read-only sandbox so the repository's core "other model
  // reads, Claude edits" boundary is enforced by the sandbox, not prompt wording
  // (ADR-136). workspace-write stays available only as an explicit machine-
  // contract opt-in (`sandbox: "workspace-write"`), keeping the tools' advertised
  // readOnlyHint honest.
  const sandboxMode =
    options.sandbox === "workspace-write" ? CLI.FLAGS.SANDBOX_WORKSPACE_WRITE : CLI.FLAGS.SANDBOX_READ_ONLY;
  const wantsSession = sessionId !== undefined;
  // Preferred tier (opt-in): try MODELS.PREFERRED first for fresh, non-edit,
  // no-explicit-model calls. Computed here — not only at the attempt below — so
  // the response cache (keyed on MODELS.DEFAULT) cannot short-circuit and serve a
  // stale base-model answer before the preferred attempt runs. See ADR-132.
  const preferredEligible =
    options.preferred === true && !options.model && !wantsSession && !editMode && MODELS.PREFERRED !== MODELS.DEFAULT;
  // includeDirs, editMode, and sandbox mode change what codex sees/returns, so
  // they must distinguish cache entries (includeDirs sorted for order-independence).
  const dirsPart = options.includeDirs?.length ? [...options.includeDirs].sort().join(":") : "";
  // Labeled parts so the marker is unambiguous — a literal includeDir of "edit"
  // must never collide with edit-mode's cache partition.
  const extraContext = `effort=${reasoningEffort};edit=${editMode ? 1 : 0};sandbox=${sandboxMode};dirs=${dirsPart}`;
  const cacheKey =
    wantsSession || preferredEligible || outputSchema
      ? null
      : ResponseCache.buildKey("codex", options.prompt, model, extraContext);

  if (cacheKey) {
    const cached = responseCache.get(cacheKey);
    if (cached) {
      Logger.debug("Response cache hit for codex");
      return { response: cached, threadId: undefined, usage: undefined };
    }
  }

  let schemaPath: string | undefined;
  try {
    if (outputSchema) {
      schemaPath = join(tmpdir(), `codex-output-schema-${process.pid}-${randomUUID()}.json`);
      writeFileSync(schemaPath, JSON.stringify(outputSchema), { mode: 0o600 });
    }

    const useStdin = outputSchema !== undefined || options.prompt.length > EXECUTION.STDIN_THRESHOLD_BYTES;
    const stdinPayload = useStdin ? options.prompt : undefined;
    const args = buildArgs(
      options.prompt,
      model,
      sessionId,
      useStdin,
      options.includeDirs,
      sandboxMode,
      schemaPath,
      reasoningEffort,
    );
    // Codex with reasoning models routinely needs >210s for substantive prompts
    // (issue #45). Resolution order: ASK_CODEX_TIMEOUT_MS > GMCPT_TIMEOUT_MS >
    // DEFAULT_CODEX_TIMEOUT_MS. The provider-specific knob lets users keep a
    // tighter global default for gemini while granting codex more headroom.
    const timeoutMs = resolveTimeoutMs(EXECUTION.CODEX_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CODEX_TIMEOUT_MS);

    // Try MODELS.PREFERRED once (opportunistic). ANY failure downgrades to the
    // standard MODELS.DEFAULT path below (which carries the quota→FALLBACK ladder).
    // Deliberately NOT signal-matched — an unknown entitlement-rejection string
    // must still fall back. See ADR-132.
    let downgradedFromPreferred = false;
    if (preferredEligible) {
      const preferredArgs = buildArgs(
        options.prompt,
        MODELS.PREFERRED,
        undefined,
        useStdin,
        options.includeDirs,
        sandboxMode,
        schemaPath,
        reasoningEffort,
      );
      const preferredStartedAt = Date.now();
      try {
        const raw = await executeCommand(
          CLI.COMMANDS.CODEX,
          preferredArgs,
          options.onProgress,
          undefined,
          stdinPayload,
          timeoutMs,
          undefined,
          options.signal,
        );
        return parseCodexJsonlOutput(raw, MODELS.PREFERRED, Date.now() - preferredStartedAt, false);
      } catch (preferredError) {
        const reason = preferredError instanceof Error ? preferredError.message : String(preferredError);
        Logger.warn(
          `Preferred Codex model ${MODELS.PREFERRED} unavailable (${reason}); falling back to ${MODELS.DEFAULT}.`,
        );
        downgradedFromPreferred = true;
      }
    }

    const startedAt = Date.now();
    try {
      const raw = await executeCommand(
        CLI.COMMANDS.CODEX,
        args,
        options.onProgress,
        undefined,
        stdinPayload,
        timeoutMs,
        undefined,
        options.signal,
      );
      const result = parseCodexJsonlOutput(raw, model, Date.now() - startedAt, downgradedFromPreferred);
      if (cacheKey) responseCache.set(cacheKey, result.response);
      return result;
    } catch (error) {
      const continuityError = translateSessionContinuityError(error, sessionId);
      if (continuityError) throw continuityError;
      if (isQuotaError(error) && model !== MODELS.FALLBACK) {
        Logger.warn(`${STATUS_MESSAGES.QUOTA_SWITCHING} Falling back to ${MODELS.FALLBACK}.`);
        Logger.debug(`Status: ${STATUS_MESSAGES.FALLBACK_RETRY}`);
        const fallbackArgs = buildArgs(
          options.prompt,
          MODELS.FALLBACK,
          sessionId,
          useStdin,
          options.includeDirs,
          sandboxMode,
          schemaPath,
          reasoningEffort,
        );
        const fallbackStartedAt = Date.now();
        try {
          const raw = await executeCommand(
            CLI.COMMANDS.CODEX,
            fallbackArgs,
            options.onProgress,
            undefined,
            stdinPayload,
            timeoutMs,
            undefined,
            options.signal,
          );
          Logger.warn(`Successfully executed with ${MODELS.FALLBACK} fallback.`);
          Logger.debug(`Status: ${STATUS_MESSAGES.FALLBACK_SUCCESS}`);
          return parseCodexJsonlOutput(raw, MODELS.FALLBACK, Date.now() - fallbackStartedAt, true);
        } catch (fallbackError) {
          const fallbackContinuityError = translateSessionContinuityError(fallbackError, sessionId);
          if (fallbackContinuityError) throw fallbackContinuityError;
          const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          // The fallback is structurally rejected for this account type (a 400,
          // not a quota) — the ladder is broken in a way `codex doctor` can't
          // diagnose, so point the user at the env var that controls it instead of
          // the generic both-failed message. #196 / ADR-126.
          if (isModelUnavailableError(fallbackError)) {
            // Tailor the remediation: "unset to use the default" only makes sense
            // when the user PINNED an incompatible model. With no pin the failing
            // model already IS the default, so recommending it back would be
            // self-contradictory (PR #198 review). The pin is the same env var
            // MODELS.FALLBACK resolves from, so its presence distinguishes them.
            const remediation = process.env.ASK_CODEX_FALLBACK_MODEL
              ? "Set ASK_CODEX_FALLBACK_MODEL to a model your account supports, or unset it to use the default (gpt-5.6-terra)."
              : "Set ASK_CODEX_FALLBACK_MODEL to a model your account supports.";
            throw new Error(
              `${MODELS.DEFAULT} quota exceeded and the fallback model "${MODELS.FALLBACK}" is not available for this Codex account type (${fallbackMsg}). ${remediation}`,
            );
          }
          throw new Error(
            `${MODELS.DEFAULT} quota exceeded, ${MODELS.FALLBACK} fallback also failed: ${fallbackMsg}. Run \`codex doctor\` to inspect your Codex CLI installation.`,
          );
        }
      }
      throw error;
    }
  } finally {
    if (schemaPath) {
      try {
        unlinkSync(schemaPath);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}
