export const ERROR_MESSAGES = {
  // Lowercased substrings; isQuotaError() lowercases the message before matching.
  // "out of credits" + "spend cap" cover the 4 codex 0.134 workspace usage-limit
  // messages (owner/member × credits/spend-cap) from PR #24114. See #127.
  QUOTA_SIGNALS: ["rate_limit_exceeded", "quota_exceeded", "429", "insufficient_quota", "out of credits", "spend cap"],
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

export const MODELS = {
  DEFAULT: process.env.ASK_CODEX_MODEL || "gpt-5.5",
  FALLBACK: process.env.ASK_CODEX_FALLBACK_MODEL || "gpt-5.5-mini",
};

export const CLI = {
  COMMANDS: {
    CODEX: "codex",
    EXEC: "exec",
    RESUME: "resume",
  },
  FLAGS: {
    MODEL: "-m",
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
