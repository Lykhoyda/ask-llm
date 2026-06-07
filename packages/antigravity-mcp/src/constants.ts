export const ERROR_MESSAGES = {
  NO_PROMPT_PROVIDED:
    "Please provide a prompt for analysis. Ask a question or describe the code you want a second opinion on.",
  NO_OUTPUT:
    "Antigravity (agy) ran but produced no readable response. Most likely you are not logged in (run `agy` once interactively to authenticate), or agy's transcript output path/schema changed (this experimental provider may need an update). agy >=1.0.6 prints to stdout; on older versions where headless `-p` did not (gemini-cli #27466), ask-antigravity-mcp reads agy's transcript files as a fallback.",
  RATE_LIMITED:
    "Antigravity (agy) hit a subscription rate limit. Google AI Pro/Ultra quotas refresh roughly every 5 hours — wait and retry, or use ask-codex / ask-gemini in the meantime.",
  TOOL_NOT_FOUND: "not found in registry",
} as const;

export const STATUS_MESSAGES = {
  ANTIGRAVITY_RESPONSE: "Antigravity response:",
} as const;

// Prepended to every prompt. ask-antigravity is a read-only "second opinion"
// tool, but agy is an agent that can act. We run with --dangerously-skip-permissions
// (required to avoid headless approval-prompt hangs) + --sandbox, and additionally
// instruct the model not to modify anything. See spec §6.
export const READ_ONLY_PREAMBLE =
  "You are giving a second opinion / code review. Read and reason only. Do NOT modify, create, or delete files, and do NOT run commands — just analyze and respond.";

export const CLI = {
  COMMANDS: {
    AGY: "agy",
  },
  FLAGS: {
    PRINT: "-p",
    ADD_DIR: "--add-dir",
    PRINT_TIMEOUT: "--print-timeout",
    SKIP_PERMISSIONS: "--dangerously-skip-permissions",
    SANDBOX: "--sandbox",
  },
} as const;

export const ANTIGRAVITY = {
  TIMEOUT_ENV_VAR: "ASK_ANTIGRAVITY_TIMEOUT_MS",
  // agy's --print-timeout defaults to 5m; mirror that as our process timeout.
  DEFAULT_TIMEOUT_MS: 300_000,
  SANDBOX_ENV_VAR: "ASK_ANTIGRAVITY_SANDBOX",
  // Lowercased substrings; isRateLimitError() lowercases the message first.
  RATE_LIMIT_SIGNALS: ["rate limit", "rate_limit", "resource_exhausted", "quota", "429", "too many requests"],
} as const;
