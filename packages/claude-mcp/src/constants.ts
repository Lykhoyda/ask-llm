export const ERROR_MESSAGES = {
  NO_PROMPT_PROVIDED:
    "Please provide a prompt for Claude to review, analyze, or answer as an independent second opinion.",
  INVALID_JSON: "Claude CLI completed without returning a valid JSON result.",
  EMPTY_RESPONSE: "Claude CLI completed successfully but returned an empty response.",
  NESTED_SESSION:
    "ask-claude cannot start Claude Code from inside an existing Claude Code session. Use this provider from Codex, Cursor, OpenCode, or another non-Claude-Code MCP host.",
} as const;

export const STATUS_MESSAGES = {
  CLAUDE_RESPONSE: "Claude response:",
} as const;

// Stable aliases intentionally track the latest model in each Claude family.
// Users who need a pinned model version can set ASK_CLAUDE_MODEL or pass model.
export const FACTORY_DEFAULT_MODEL = "opus";

export const MODELS = {
  DEFAULT: process.env.ASK_CLAUDE_MODEL || FACTORY_DEFAULT_MODEL,
  FALLBACK: process.env.ASK_CLAUDE_FALLBACK_MODEL || "sonnet",
} as const;

export const READ_ONLY_SYSTEM_PROMPT =
  "You are an independent second-opinion reviewer. Inspect the available context and report your analysis, but do not modify files or perform external actions. The calling MCP client is responsible for any changes.";

export const CLI = {
  COMMAND: "claude",
  FLAGS: {
    PRINT: "--print",
    OUTPUT_FORMAT: "--output-format",
    JSON: "json",
    MODEL: "--model",
    FALLBACK_MODEL: "--fallback-model",
    RESUME: "--resume",
    ADD_DIR: "--add-dir",
    SAFE_MODE: "--safe-mode",
    TOOLS: "--tools",
    READ_ONLY_TOOLS: "Read,Glob,Grep",
    PERMISSION_MODE: "--permission-mode",
    DONT_ASK: "dontAsk",
    APPEND_SYSTEM_PROMPT: "--append-system-prompt",
  },
} as const;

export const CLAUDE_HOST_ENV_VAR = "CLAUDECODE";
