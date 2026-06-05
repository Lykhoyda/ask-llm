import {
  cacheChunks,
  chunkChangeModeEdits,
  type EditChunk,
  EXECUTION,
  executeCommand,
  formatChangeModeResponse,
  getChunks,
  Logger,
  parseChangeModeOutput,
  ResponseCache,
  resolveTimeoutMs,
  responseCache,
  summarizeChangeModeEdits,
  type UsageStats,
  validateChangeModeEdits,
} from "@ask-llm/shared";
import {
  CLI,
  ERROR_MESSAGES,
  MODELS,
  QUOTA_PATTERNS,
  STATUS_MESSAGES,
  WORKSPACE_TRUST_PATTERNS,
} from "../constants.js";
import { classifyGeminiCliError, formatTierNote, resolveTierCutoff } from "./tierGuidance.js";

interface GeminiModelTokens {
  input?: number;
  candidates?: number;
  cached?: number;
  thoughts?: number;
}

interface GeminiCliStats {
  models?: Record<string, { tokens?: GeminiModelTokens }>;
}

interface GeminiJsonResponse {
  session_id?: string;
  response?: string;
  stats?: GeminiCliStats;
  error?:
    | {
        message?: string;
        code?: number;
      }
    | string
    | unknown[];
}

export interface GeminiExecutorOptions {
  prompt: string;
  model?: string;
  sandbox?: boolean;
  changeMode?: boolean;
  sessionId?: string;
  includeDirs?: string[];
  onProgress?: (newOutput: string) => void;
}

export interface GeminiExecutorResult {
  response: string;
  sessionId: string | undefined;
  usage: UsageStats | undefined;
}

function pickPrimaryModelStats(
  stats: GeminiCliStats | undefined,
): { model: string; tokens: GeminiModelTokens } | undefined {
  if (!stats?.models) return undefined;
  const entries = Object.entries(stats.models);
  if (entries.length === 0) return undefined;
  let best: { model: string; tokens: GeminiModelTokens } | undefined;
  for (const [model, modelData] of entries) {
    const tokens = modelData?.tokens;
    if (!tokens) continue;
    const totalThis = (tokens.input ?? 0) + (tokens.candidates ?? 0);
    const totalBest = best ? (best.tokens.input ?? 0) + (best.tokens.candidates ?? 0) : -1;
    if (totalThis > totalBest) best = { model, tokens };
  }
  return best;
}

function buildUsageStats(
  json: GeminiJsonResponse,
  requestedModel: string,
  durationMs: number,
  fellBack: boolean,
): UsageStats {
  const primary = pickPrimaryModelStats(json.stats);
  return {
    provider: "gemini",
    model: primary?.model ?? requestedModel,
    inputTokens: primary?.tokens.input,
    outputTokens: primary?.tokens.candidates,
    cachedTokens: primary?.tokens.cached,
    thinkingTokens: primary?.tokens.thoughts,
    durationMs,
    fellBack,
  };
}

function formatStats(stats: GeminiCliStats | undefined): string {
  if (!stats?.models) return "";
  const parts: string[] = [];
  for (const [modelName, modelData] of Object.entries(stats.models)) {
    const tokens = modelData?.tokens;
    if (!tokens) continue;
    if (tokens.input != null) parts.push(`${tokens.input.toLocaleString()} input tokens`);
    if (tokens.candidates != null) parts.push(`${tokens.candidates.toLocaleString()} output tokens`);
    if (tokens.thoughts != null && tokens.thoughts > 0)
      parts.push(`${tokens.thoughts.toLocaleString()} thinking tokens`);
    if (tokens.cached != null && tokens.cached > 0) parts.push(`${tokens.cached.toLocaleString()} cached`);
    parts.push(`model: ${modelName}`);
  }
  return parts.length > 0 ? `\n\n[Gemini stats: ${parts.join(", ")}]` : "";
}

function extractJson(raw: string): string | null {
  let startIndex = raw.indexOf("{");
  let fallback: string | null = null;

  while (startIndex !== -1) {
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = startIndex; i < raw.length; i++) {
      const char = raw[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (inString && char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === "{") braceCount++;
        else if (char === "}") braceCount--;

        if (braceCount === 0) {
          const candidate = raw.slice(startIndex, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (startIndex > 0) {
              Logger.debug("Skipping non-JSON prefix in Gemini output");
            }
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed) &&
              ("response" in parsed || "error" in parsed)
            ) {
              return candidate;
            }
            if (fallback === null) {
              fallback = candidate;
            }
          } catch {
            break;
          }
        }
      }
    }
    startIndex = raw.indexOf("{", startIndex + 1);
  }
  return fallback;
}

function parseGeminiJsonOutput(
  raw: string,
  requestedModel: string,
  durationMs: number,
  fellBack: boolean,
): GeminiExecutorResult {
  const jsonStr = extractJson(raw);
  if (!jsonStr) {
    Logger.debug("Gemini output has no JSON object, using raw text");
    return { response: raw, sessionId: undefined, usage: undefined };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    Logger.debug("Gemini output is not valid JSON, using raw text");
    return { response: raw, sessionId: undefined, usage: undefined };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    Logger.debug("Gemini output is not a JSON object, using raw text");
    return { response: raw, sessionId: undefined, usage: undefined };
  }

  const json = parsed as GeminiJsonResponse;

  if (json.error) {
    if (typeof json.error === "string") {
      throw new Error(json.error);
    }
    if (Array.isArray(json.error)) {
      throw new Error(`Gemini error: ${JSON.stringify(json.error)}`);
    }
    const msg = json.error.message ?? `Gemini error code ${json.error.code ?? "unknown"}`;
    throw new Error(msg);
  }

  if (typeof json.response !== "string") {
    Logger.debug("Gemini JSON missing response field, using raw text");
    return { response: raw, sessionId: undefined, usage: undefined };
  }

  return {
    response: json.response + formatStats(json.stats),
    sessionId: json.session_id,
    usage: buildUsageStats(json, requestedModel, durationMs, fellBack),
  };
}

interface GeminiStreamModelStats {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached?: number;
  input?: number;
  thoughts?: number;
}

interface GeminiStreamStats {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached?: number;
  duration_ms?: number;
  tool_calls?: number;
  models?: Record<string, GeminiStreamModelStats>;
}

interface GeminiStreamEvent {
  type?: string;
  session_id?: string;
  model?: string;
  role?: string;
  content?: string;
  delta?: boolean;
  status?: string;
  error?: unknown;
  message?: string;
  reason?: string;
  stats?: GeminiStreamStats;
}

function streamStatsToCliStats(stats: GeminiStreamStats | undefined): GeminiCliStats | undefined {
  if (!stats?.models) return undefined;
  const models: Record<string, { tokens?: GeminiModelTokens }> = {};
  for (const [name, m] of Object.entries(stats.models)) {
    models[name] = {
      tokens: {
        input: m.input_tokens ?? m.input,
        candidates: m.output_tokens,
        cached: m.cached,
        thoughts: m.thoughts,
      },
    };
  }
  return { models };
}

// stream-json event types we explicitly handle. Anything outside this set is
// logged (not silently dropped) so new upstream event variants surface in
// debug output instead of vanishing (#116). AgentExecutionStopped/Blocked
// (gemini-cli v0.43+) are now handled as terminal errors rather than logged,
// since their reason/message is actionable (#139, unblocked by 0.45.0 stable).
const RECOGNIZED_STREAM_EVENT_TYPES = new Set([
  "init",
  "message",
  "result",
  "error",
  "AgentExecutionStopped",
  "AgentExecutionBlocked",
]);

export function parseGeminiStreamJsonl(
  raw: string,
  requestedModel: string,
  durationMs: number,
  fellBack: boolean,
): GeminiExecutorResult {
  const lines = raw.split("\n");
  let assembled = "";
  let sawAnyAssistantMessage = false;
  let sessionId: string | undefined;
  let stats: GeminiStreamStats | undefined;
  let errorMsg: string | undefined;
  let parsedAnyEvent = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith("{")) continue;
    let event: GeminiStreamEvent;
    try {
      event = JSON.parse(line) as GeminiStreamEvent;
    } catch {
      continue;
    }
    if (typeof event.type !== "string") continue;
    parsedAnyEvent = true;

    if (event.type === "init" && typeof event.session_id === "string") {
      sessionId = event.session_id;
    } else if (event.type === "message" && event.role === "assistant" && typeof event.content === "string") {
      if (event.delta) {
        assembled += event.content;
      } else {
        assembled = event.content;
      }
      sawAnyAssistantMessage = true;
    } else if (event.type === "result") {
      stats = event.stats;
      if (event.status === "error") {
        const err = event.error;
        errorMsg = typeof err === "string" ? err : err ? JSON.stringify(err) : "Gemini result reported error status";
      }
    } else if (event.type === "error") {
      errorMsg = typeof event.message === "string" ? event.message : JSON.stringify(event);
    } else if (event.type === "AgentExecutionStopped" || event.type === "AgentExecutionBlocked") {
      // gemini-cli v0.43+ stop/block events carry the actionable reason
      // (workspace-trust block, tool denial, policy, …). Surface as a terminal
      // error instead of dropping to debug — mirror the `error` extraction.
      const detail =
        (typeof event.reason === "string" && event.reason) ||
        (typeof event.message === "string" && event.message) ||
        (typeof event.error === "string" ? event.error : event.error ? JSON.stringify(event.error) : "") ||
        JSON.stringify(event);
      errorMsg = `Gemini ${event.type}: ${detail}`;
    } else if (!RECOGNIZED_STREAM_EVENT_TYPES.has(event.type)) {
      Logger.debug(`Unrecognized Gemini stream-json event type: ${event.type}`);
    }
  }

  if (!parsedAnyEvent) {
    return parseGeminiJsonOutput(raw, requestedModel, durationMs, fellBack);
  }

  if (errorMsg) {
    throw new Error(errorMsg);
  }

  if (!sawAnyAssistantMessage) {
    Logger.debug("Gemini stream produced no assistant content; falling back to raw text");
    return { response: raw, sessionId, usage: undefined };
  }

  const cliStats = streamStatsToCliStats(stats);
  const fakeJson: GeminiJsonResponse = { session_id: sessionId, response: assembled, stats: cliStats };
  return {
    response: assembled + formatStats(cliStats),
    sessionId,
    usage: buildUsageStats(fakeJson, requestedModel, durationMs, fellBack),
  };
}

export function makeStreamingProgressForwarder(onProgress?: (text: string) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    if (!onProgress) return;
    buffer += chunk;
    let nl: number = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
      if (!line || !line.startsWith("{")) continue;
      let event: GeminiStreamEvent;
      try {
        event = JSON.parse(line) as GeminiStreamEvent;
      } catch {
        continue;
      }
      if (event.type === "message" && event.role === "assistant" && typeof event.content === "string") {
        onProgress(event.content);
      }
    }
  };
}

function buildArgs(
  prompt: string,
  model: string | undefined,
  sandbox: boolean | undefined,
  sessionId: string | undefined,
  includeDirs: string[] | undefined,
  useStdin?: boolean,
): string[] {
  const args: string[] = [];
  if (model) args.push(CLI.FLAGS.MODEL, model);
  if (sandbox) args.push(CLI.FLAGS.SANDBOX);
  if (sessionId) args.push(CLI.FLAGS.RESUME, sessionId);
  if (includeDirs?.length) {
    for (const dir of includeDirs) {
      args.push(CLI.FLAGS.INCLUDE_DIRECTORIES, dir);
    }
  }
  args.push(CLI.FLAGS.OUTPUT_FORMAT, CLI.OUTPUT_FORMATS.STREAM_JSON);
  // Gemini requires -p for headless mode; when piping via stdin, pass an empty
  // placeholder. Per Gemini CLI help, stdin content is concatenated with -p text.
  args.push(CLI.FLAGS.PROMPT, useStdin ? "" : prompt);
  return args;
}

function createGeminiStderrHandler(): (chunk: string) => void {
  let buffer = "";
  let quotaLogged = false;
  let trustLogged = false;
  return (chunk: string) => {
    buffer += chunk;
    if (!quotaLogged && buffer.includes("RESOURCE_EXHAUSTED")) {
      quotaLogged = true;
      const modelMatch = buffer.match(/Quota exceeded for quota metric '([^']+)'/);
      const statusMatch = buffer.match(/status["\s]*[:=]\s*(\d+)/);
      const reasonMatch = buffer.match(/"reason":\s*"([^"]+)"/);
      const model = modelMatch ? modelMatch[1] : "Unknown Model";
      const status = statusMatch ? statusMatch[1] : "429";
      const reason = reasonMatch ? reasonMatch[1] : "rateLimitExceeded";
      Logger.error(`Gemini Quota Error: code=${status}, model=${model}, reason=${reason}`);
    }
    if (!trustLogged && WORKSPACE_TRUST_PATTERNS.some((pattern) => buffer.includes(pattern))) {
      trustLogged = true;
      Logger.warn(STATUS_MESSAGES.WORKSPACE_TRUST_DETECTED);
    }
  };
}

function ensureWorkspaceTrustEnv(): void {
  // gemini-cli renamed the trust env var in main → 0.42:
  //   - gemini ≤ 0.41 reads GEMINI_TRUST_WORKSPACE
  //   - gemini ≥ 0.42 reads GEMINI_CLI_TRUST_WORKSPACE only (no backward alias)
  // Co-emit both names so one ask-gemini-mcp release works against any gemini-cli
  // version in current rotation, with zero runtime version detection. The old
  // name is dropped in a future major release. Issue #46 / ADR-075.
  if (process.env.ASK_GEMINI_REQUIRE_WORKSPACE_TRUST === "1") return;
  if (process.env.GEMINI_TRUST_WORKSPACE !== undefined) return;
  if (process.env.GEMINI_CLI_TRUST_WORKSPACE !== undefined) return;
  process.env.GEMINI_TRUST_WORKSPACE = "true";
  process.env.GEMINI_CLI_TRUST_WORKSPACE = "true";
}

function isWorkspaceTrustError(message: string): boolean {
  const lower = message.toLowerCase();
  return WORKSPACE_TRUST_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()));
}

// Converts standalone `file:<path>` tokens to Gemini's `@<path>` include
// syntax (changeMode only). Anchored to start-of-string or whitespace so it
// never mangles substrings like "profile:" or "Makefile:", and the `//`
// lookahead leaves `file://` URLs intact.
export function convertFileSyntaxToAt(prompt: string): string {
  return prompt.replace(/(^|\s)file:(?!\/\/)(\S+)/g, "$1@$2");
}

export async function executeGeminiCLI(options: GeminiExecutorOptions): Promise<GeminiExecutorResult> {
  ensureWorkspaceTrustEnv();
  const { model, sandbox, changeMode, sessionId, includeDirs, onProgress } = options;
  let promptProcessed = options.prompt;

  if (changeMode) {
    promptProcessed = convertFileSyntaxToAt(promptProcessed);

    const changeModeInstructions = `
[CHANGEMODE INSTRUCTIONS]
You are generating code modifications that will be processed by an automated system. The output format is critical because it enables programmatic application of changes without human intervention.

INSTRUCTIONS:
1. Analyze each provided file thoroughly
2. Identify locations requiring changes based on the user request
3. For each change, output in the exact format specified
4. The OLD section must be EXACTLY what appears in the file (copy-paste exact match)
5. Provide complete, directly replacing code blocks
6. Verify line numbers are accurate

CRITICAL REQUIREMENTS:
1. Output edits in the EXACT format specified below - no deviations
2. The OLD string MUST be findable with Ctrl+F - it must be a unique, exact match
3. Include enough surrounding lines to make the OLD string unique
4. If a string appears multiple times (like </div>), include enough context lines above and below to make it unique
5. Copy the OLD content EXACTLY as it appears - including all whitespace, indentation, line breaks
6. Never use partial lines - always include complete lines from start to finish

OUTPUT FORMAT (follow exactly):
**FILE: [filename]:[line_number]**
\`\`\`
OLD:
[exact code to be replaced - must match file content precisely]
NEW:
[new code to insert - complete and functional]
\`\`\`

EXAMPLE 1 - Simple unique match:
**FILE: src/utils/helper.js:100**
\`\`\`
OLD:
function getMessage() {
  return "Hello World";
}
NEW:
function getMessage() {
  return "Hello Universe!";
}
\`\`\`

EXAMPLE 2 - Common tag needing context:
**FILE: index.html:245**
\`\`\`
OLD:
        </div>
      </div>
    </section>
NEW:
        </div>
      </footer>
    </section>
\`\`\`

IMPORTANT: The OLD section must be an EXACT copy from the file that can be found with Ctrl+F!

USER REQUEST:
${promptProcessed}
`;
    promptProcessed = changeModeInstructions;
  }

  const useStdin = promptProcessed.length > EXECUTION.STDIN_THRESHOLD_BYTES;
  const stdinPayload = useStdin ? promptProcessed : undefined;
  const args = buildArgs(promptProcessed, model || MODELS.PRO, sandbox, sessionId, includeDirs, useStdin);

  const resolvedModel = model || MODELS.PRO;
  const isCacheable = !sessionId && !sandbox && !changeMode;
  const extraContext = includeDirs?.length ? includeDirs.sort().join(":") : undefined;
  const cacheKey = isCacheable ? ResponseCache.buildKey("gemini", options.prompt, resolvedModel, extraContext) : null;

  if (cacheKey) {
    const cached = responseCache.get(cacheKey);
    if (cached) {
      Logger.debug("Response cache hit for gemini");
      return { response: cached, sessionId: undefined, usage: undefined };
    }
  }

  // Gemini's stream-json mode emits assistant tokens incrementally, so the
  // global 210s default has historically been adequate. The provider knob
  // (ASK_GEMINI_TIMEOUT_MS) exists for symmetry with codex and to give users
  // a way to lengthen gemini's timeout independently of GMCPT_TIMEOUT_MS.
  const timeoutMs = resolveTimeoutMs(EXECUTION.GEMINI_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_TIMEOUT_MS);

  const startedAt = Date.now();
  try {
    const streamingForwarder = makeStreamingProgressForwarder(onProgress);
    const raw = await executeCommand(
      CLI.COMMANDS.GEMINI,
      args,
      streamingForwarder,
      createGeminiStderrHandler(),
      stdinPayload,
      timeoutMs,
    );
    const result = parseGeminiStreamJsonl(raw, resolvedModel, Date.now() - startedAt, false);
    if (cacheKey) {
      responseCache.set(cacheKey, result.response);
    }
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (isWorkspaceTrustError(errorMessage)) {
      throw new Error(ERROR_MESSAGES.WORKSPACE_TRUST_REQUIRED);
    }
    const isQuotaError = QUOTA_PATTERNS.some((pattern) => errorMessage.toLowerCase().includes(pattern.toLowerCase()));
    if (isQuotaError && model !== MODELS.FLASH) {
      Logger.warn(`Gemini quota exceeded. Falling back to ${MODELS.FLASH}.`);
      Logger.debug(`Status: ${STATUS_MESSAGES.FLASH_RETRY}`);
      const fallbackArgs = buildArgs(promptProcessed, MODELS.FLASH, sandbox, sessionId, includeDirs, useStdin);
      const fallbackStartedAt = Date.now();
      try {
        const fallbackForwarder = makeStreamingProgressForwarder(onProgress);
        const raw = await executeCommand(
          CLI.COMMANDS.GEMINI,
          fallbackArgs,
          fallbackForwarder,
          createGeminiStderrHandler(),
          stdinPayload,
          timeoutMs,
        );
        Logger.warn(`Successfully executed with ${MODELS.FLASH} fallback.`);
        Logger.debug(`Status: ${STATUS_MESSAGES.FLASH_SUCCESS}`);
        return parseGeminiStreamJsonl(raw, MODELS.FLASH, Date.now() - fallbackStartedAt, true);
      } catch (fallbackError) {
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        // Pro is quota by construction here; discriminate on the Flash failure
        // class so a transient Flash timeout doesn't masquerade as tier death.
        const composed = `${MODELS.PRO} quota exceeded, ${MODELS.FLASH} fallback also failed: ${fallbackErrorMessage}`;
        const flashClass = classifyGeminiCliError(fallbackErrorMessage);
        throw new Error(formatTierNote(composed, flashClass, new Date(), resolveTierCutoff()));
      }
    } else {
      // Non-quota, non-trust errors (incl. raw 401/403 auth) land here with no
      // Flash retry. Enrich only when the date+class gate adds a note; otherwise
      // re-throw the original error untouched.
      const enriched = formatTierNote(
        errorMessage,
        classifyGeminiCliError(errorMessage),
        new Date(),
        resolveTierCutoff(),
      );
      if (enriched !== errorMessage) throw new Error(enriched);
      throw error;
    }
  }
}

export function processChangeModeOutput(
  rawResult: string,
  chunkIndex?: number,
  chunkCacheKey?: string,
  prompt?: string,
): string {
  if (chunkIndex && chunkCacheKey) {
    const cachedChunks = getChunks(chunkCacheKey);
    if (cachedChunks && chunkIndex > 0 && chunkIndex <= cachedChunks.length) {
      Logger.debug(`Using cached chunk ${chunkIndex} of ${cachedChunks.length}`);
      const chunk = cachedChunks[chunkIndex - 1];
      let result = formatChangeModeResponse(chunk.edits, {
        current: chunkIndex,
        total: cachedChunks.length,
        cacheKey: chunkCacheKey,
      });

      if (chunkIndex === 1 && chunk.edits.length > 5) {
        const allEdits = cachedChunks.flatMap((c: EditChunk) => c.edits);
        result = `${summarizeChangeModeEdits(allEdits)}\n\n${result}`;
      }

      return result;
    }
    Logger.debug(`Cache miss or invalid chunk index, processing new result`);
  }

  const edits = parseChangeModeOutput(rawResult);

  if (edits.length === 0) {
    const truncated =
      rawResult.length > EXECUTION.ERROR_TRUNCATE_LENGTH
        ? rawResult.slice(0, EXECUTION.ERROR_TRUNCATE_LENGTH) +
          `\n... (truncated ${rawResult.length - EXECUTION.ERROR_TRUNCATE_LENGTH} chars)`
        : rawResult;
    return `No edits found in Gemini's response. Please ensure Gemini uses the OLD/NEW format. \n\n+ ${truncated}`;
  }

  const validation = validateChangeModeEdits(edits);
  if (!validation.valid) {
    return `Edit validation failed:\n${validation.errors.join("\n")}`;
  }

  const chunks = chunkChangeModeEdits(edits);

  let cacheKey: string | undefined;
  if (chunks.length > 1 && prompt) {
    cacheKey = cacheChunks(prompt, chunks);
    Logger.debug(`Cached ${chunks.length} chunks with key: ${cacheKey}`);
  }

  const returnChunkIndex = chunkIndex && chunkIndex > 0 && chunkIndex <= chunks.length ? chunkIndex : 1;
  const returnChunk = chunks[returnChunkIndex - 1];

  let result = formatChangeModeResponse(
    returnChunk.edits,
    chunks.length > 1 ? { current: returnChunkIndex, total: chunks.length, cacheKey } : undefined,
  );

  if (returnChunkIndex === 1 && edits.length > 5) {
    result = `${summarizeChangeModeEdits(edits, chunks.length > 1)}\n\n${result}`;
  }

  Logger.debug(
    `ChangeMode: Parsed ${edits.length} edits, ${chunks.length} chunks, returning chunk ${returnChunkIndex}`,
  );
  return result;
}
