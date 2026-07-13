export const LOG_PREFIX = "[GMCPT]";

export const LOG_LEVEL_ENV_VAR = "GMCPT_LOG_LEVEL";

export const PROTOCOL = {
  ROLES: {
    USER: "user",
    ASSISTANT: "assistant",
  },
  CONTENT_TYPES: {
    TEXT: "text",
  },
  STATUS: {
    SUCCESS: "success",
    ERROR: "error",
    FAILED: "failed",
    REPORT: "report",
  },
  NOTIFICATIONS: {
    PROGRESS: "notifications/progress",
  },
  KEEPALIVE_INTERVAL: 25000,
} as const;

export const EXECUTION = {
  DEFAULT_TIMEOUT_MS: 210_000,
  // Codex with reasoning models (GPT-5.6 family) frequently needs more than
  // the global default for substantive prompts — the model spends real wall
  // time on reasoning before emitting any output. 800s aligns with the
  // documented "≥800s for codex" guidance and addresses #45.
  DEFAULT_CODEX_TIMEOUT_MS: 800_000,
  // Claude Opus can spend several minutes on repository-scale reviews. Keep the
  // ceiling below Codex's reasoning-model allowance while leaving enough room
  // for native tool-assisted reads and subscription-backed generation.
  DEFAULT_CLAUDE_TIMEOUT_MS: 600_000,
  // Local Ollama models can spend minutes loading weights or generating on
  // modest hardware (the default is a 27b model), so the bound is generous —
  // its job is to catch a wedged server, not to police slow generation.
  DEFAULT_OLLAMA_TIMEOUT_MS: 600_000,
  TIMEOUT_ENV_VAR: "GMCPT_TIMEOUT_MS",
  CODEX_TIMEOUT_ENV_VAR: "ASK_CODEX_TIMEOUT_MS",
  CLAUDE_TIMEOUT_ENV_VAR: "ASK_CLAUDE_TIMEOUT_MS",
  GEMINI_TIMEOUT_ENV_VAR: "ASK_GEMINI_TIMEOUT_MS",
  OLLAMA_TIMEOUT_ENV_VAR: "ASK_OLLAMA_TIMEOUT_MS",
  ERROR_TRUNCATE_LENGTH: 2000,
  STDIN_THRESHOLD_BYTES: 16_384,
} as const;

export interface BaseToolArguments {
  prompt?: string;
  message?: string;
  [key: string]: string | boolean | number | string[] | undefined;
}
