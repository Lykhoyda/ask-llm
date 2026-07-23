export const MINIMUM_AGY_VERSION = "1.1.5";

export const ERROR_MESSAGES = {
  NO_PROMPT_PROVIDED:
    "Please provide a prompt for analysis. Ask a question or describe the code you want a second opinion on.",
  NO_OUTPUT: `Antigravity (agy) ran but produced no readable response. Most likely you are not logged in (run \`agy\` once interactively to authenticate), or agy's stdout/transcript output changed (this experimental provider may need an update). @ask-llm/antigravity-mcp requires agy >=${MINIMUM_AGY_VERSION} and reads agy's transcript files when stdout does not contain the answer.`,
  RATE_LIMITED:
    "Antigravity (agy) hit a subscription rate limit. Google AI Pro/Ultra quotas refresh roughly every 5 hours — wait and retry, or use ask-codex / ask-gemini in the meantime.",
  TOOL_NOT_FOUND: "not found in registry",
} as const;

export const STATUS_MESSAGES = {
  ANTIGRAVITY_RESPONSE: "Antigravity response:",
} as const;

// Machine callers also enforce plan+sandbox at the CLI layer.
export const READ_ONLY_PREAMBLE =
  "You are giving a second opinion / code review. Read and reason only. Do NOT modify, create, or delete files, and do NOT run commands — just analyze and respond.";

export const CLI = {
  COMMANDS: {
    AGY: "agy",
  },
  FLAGS: {
    VERSION: "--version",
    PRINT: "-p",
    ADD_DIR: "--add-dir",
    MODEL: "--model",
    PRINT_TIMEOUT: "--print-timeout",
    MODE: "--mode",
    PLAN: "plan",
    SKIP_PERMISSIONS: "--dangerously-skip-permissions",
    SANDBOX: "--sandbox",
    EFFORT: "--effort",
  },
} as const;

// agy 1.1.5 split model selection into a base slug (`agy models`) plus a separate
// `--effort low|medium|high` flag. Default to Gemini 3.1 Pro at high effort — the
// strongest reasoning tier — for the code-review / second-opinion workload, and
// fall back to Gemini 3.5 Flash when Pro hits a subscription rate limit. `--effort`
// conflicts with effort-carrying names ("Gemini 3.1 Pro (High)", gemini-3.1-pro-high),
// so the default effort is only emitted alongside these base slugs, while an
// explicit ASK_ANTIGRAVITY_EFFORT is always emitted — the user owns that combo
// (verified against agy 1.1.5). Override via ASK_ANTIGRAVITY_MODEL (legacy
// display strings still resolve).
export const MODELS = {
  DEFAULT: "gemini-3.1-pro",
  FALLBACK: "gemini-3.5-flash",
  // Reported as the result model when a model-unavailable retry let agy pick.
  AGY_DEFAULT_LABEL: "agy default",
} as const;

export const ANTIGRAVITY = {
  MINIMUM_AGY_VERSION,
  VERSION_CHECK_TIMEOUT_MS: 5_000,
  TIMEOUT_ENV_VAR: "ASK_ANTIGRAVITY_TIMEOUT_MS",
  // agy's --print-timeout defaults to 5m; mirror that as our process timeout.
  DEFAULT_TIMEOUT_MS: 300_000,
  SANDBOX_ENV_VAR: "ASK_ANTIGRAVITY_SANDBOX",
  MODEL_ENV_VAR: "ASK_ANTIGRAVITY_MODEL",
  EFFORT_ENV_VAR: "ASK_ANTIGRAVITY_EFFORT",
  DEFAULT_EFFORT: "high",
  VALID_EFFORTS: ["low", "medium", "high"],
  // Lowercased substrings; isRateLimitError() lowercases the message first.
  RATE_LIMIT_SIGNALS: ["rate limit", "rate_limit", "resource_exhausted", "quota", "429", "too many requests"],
  // agy 1.1.5 rejects an unresolvable --model/--effort selection with
  // `Error: invalid model selection (...): model X is not recognized as a known
  // model or custom model in settings` (verified live). The trailing `Available
  // models:` list is NOT a signal — other errors could print it too. Disjoint
  // from RATE_LIMIT_SIGNALS so drift never masquerades as quota.
  MODEL_UNAVAILABLE_SIGNALS: ["invalid model selection", "is not recognized as a known model"],
} as const;
