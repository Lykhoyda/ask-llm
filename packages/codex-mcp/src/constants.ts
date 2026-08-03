export const ERROR_MESSAGES = {
  // Lowercased substrings; isQuotaError() lowercases the message before matching.
  // "out of credits" + "spend cap" cover the 4 codex 0.134 workspace usage-limit
  // messages (owner/member × credits/spend-cap) from PR #24114. See #127.
  // "usage limit" covers codex 0.137's "You've hit your usage limit" (ChatGPT
  // plan exhaustion), reported on stdout JSONL — see ADR-117.
  QUOTA_SIGNALS: [
    "rate_limit_exceeded",
    "quota_exceeded",
    "429",
    "insufficient_quota",
    "out of credits",
    "spend cap",
    "usage limit",
  ],
  // codex 0.136 archived sessions: `codex exec resume <id>` fails if the session
  // was archived. Lowercased substrings; isArchivedSessionError() lowercases
  // before matching. "archived_sessions" is the rollout path from upstream
  // openai/codex#19362 — confirm the exact string against a live archived
  // session on codex >= 0.136. #139 / #141 F1.
  ARCHIVED_SESSION_SIGNALS: ["archived_sessions", "archived session", "session is archived"],
  // An ephemeral or expired thread has no persisted rollout for `exec resume`.
  // This is a continuity failure, never quota: retrying with a mini model cannot
  // recreate the missing first turn. Verified against codex-cli 0.146.0 (#254).
  SESSION_CONTINUITY_SIGNALS: ["no rollout found"],
  // A pinned ASK_CODEX_FALLBACK_MODEL can be structurally unavailable on some
  // account types — e.g. gpt-5.5-mini is rejected with a 400 ("not supported when
  // using Codex with a ChatGPT account") on ChatGPT-plan accounts. The built-in
  // GPT-5.6 Terra fallback avoids that legacy pin, while this guard keeps any
  // user-pinned-incompatible fallback graceful. Matched only on the FALLBACK leg
  // after a primary quota error → the ladder is broken (same "no usable model"
  // exhaustion). Ports MODEL_UNAVAILABLE_SIGNALS from codex-pair-watch.mjs
  // (ADR-123). Lowercased substrings; isModelUnavailableError() lowercases first.
  MODEL_UNAVAILABLE_SIGNALS: ["is not supported when using codex with a chatgpt"],
  NO_PROMPT_PROVIDED:
    "Please provide a prompt for analysis. Ask general questions or describe the code you want reviewed.",
  TOOL_NOT_FOUND: "not found in registry",
} as const;

export const STATUS_MESSAGES = {
  QUOTA_SWITCHING: "Codex quota exceeded, switching to fallback model...",
  FALLBACK_RETRY: "Retrying with fallback model...",
  FALLBACK_SUCCESS: "Fallback model completed successfully",
  CODEX_RESPONSE: "Codex response:",
} as const;

// The out-of-box default, independent of any ASK_CODEX_MODEL override —
// tool descriptions and drift-guard tests reference this, not the live value.
export const FACTORY_DEFAULT_MODEL = "gpt-5.6-sol";

export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];
export const FACTORY_DEFAULT_REASONING_EFFORT: CodexReasoningEffort = "medium";

export function isCodexReasoningEffort(value: string | undefined): value is CodexReasoningEffort {
  return value !== undefined && (CODEX_REASONING_EFFORTS as readonly string[]).includes(value);
}

const configuredReasoningEffort = process.env.ASK_CODEX_REASONING_EFFORT;
export const DEFAULT_REASONING_EFFORT = isCodexReasoningEffort(configuredReasoningEffort)
  ? configuredReasoningEffort
  : FACTORY_DEFAULT_REASONING_EFFORT;

export const MODELS = {
  DEFAULT: process.env.ASK_CODEX_MODEL || FACTORY_DEFAULT_MODEL,
  // GPT-5.6 replaces the separate Pro slug with the Sol flagship model. Keep
  // the preferred escape hatch for existing integrations; by default it now
  // collapses to DEFAULT, and the executor avoids a duplicate attempt.
  PREFERRED: process.env.ASK_CODEX_PREFERRED_MODEL || FACTORY_DEFAULT_MODEL,
  // Terra is the balanced/lower-cost GPT-5.6 tier and the role-preserving
  // successor to the previous gpt-5.4-mini quota fallback. Users can still pin
  // another supported model through ASK_CODEX_FALLBACK_MODEL.
  FALLBACK: process.env.ASK_CODEX_FALLBACK_MODEL || "gpt-5.6-terra",
};

export const CLI = {
  COMMANDS: {
    CODEX: "codex",
    EXEC: "exec",
    RESUME: "resume",
  },
  FLAGS: {
    MODEL: "-m",
    CONFIG: "-c",
    SKIP_GIT: "--skip-git-repo-check",
    EPHEMERAL: "--ephemeral",
    JSON: "--json",
    // --full-auto was sugar for `--sandbox workspace-write` (codex 0.128 prints a
    // deprecation warning on every call; 0.129-alpha makes it a hidden trap with
    // `conflicts_with = "dangerously_bypass_approvals_and_sandbox"`). codex `exec`
    // is already non-interactive by definition, so we only need the sandbox part —
    // approval-never is implicit in the subcommand. Issue #46 / ADR-075.
    SANDBOX: "--sandbox",
    SANDBOX_WORKSPACE_WRITE: "workspace-write",
    IGNORE_USER_CONFIG: "--ignore-user-config",
    IGNORE_RULES: "--ignore-rules",
    ADD_DIR: "--add-dir",
    OUTPUT_SCHEMA: "--output-schema",
    SANDBOX_READ_ONLY: "read-only",
  },
} as const;

// JSON Schema handed to `codex exec --output-schema <file>` for ask-codex-edit.
// Constrains codex's final response to a list of search/replace edits against
// existing files. The model only proposes; Claude applies (read-only sandbox).
export const CODEX_EDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    edits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          file: { type: "string", description: "Repo-relative path to an existing file" },
          // OpenAI strict structured-output requires every property in `required`;
          // optional fields are expressed as nullable instead.
          startLine: { type: ["integer", "null"], description: "1-based line where oldCode begins (or null)" },
          oldCode: { type: "string", description: "Exact existing text to replace (must match the file verbatim)" },
          newCode: { type: "string", description: "Replacement text" },
          description: { type: ["string", "null"], description: "One-line rationale (or null)" },
        },
        required: ["file", "startLine", "oldCode", "newCode", "description"],
      },
    },
  },
  required: ["edits"],
} as const;
