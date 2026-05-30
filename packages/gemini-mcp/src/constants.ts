import type { BaseToolArguments } from "@ask-llm/shared";

export const QUOTA_PATTERNS = ["RESOURCE_EXHAUSTED", "TerminalQuotaError", "exhausted your capacity"] as const;

export const WORKSPACE_TRUST_PATTERNS = ["FatalUntrustedWorkspaceError", "not running in a trusted directory"] as const;

export const ERROR_MESSAGES = {
  QUOTA_EXCEEDED: "RESOURCE_EXHAUSTED",
  QUOTA_EXCEEDED_SHORT: "⚠️ Gemini Pro daily quota exceeded. Please retry with model: 'gemini-3.5-flash'",
  TOOL_NOT_FOUND: "not found in registry",
  NO_PROMPT_PROVIDED:
    "Please provide a prompt for analysis. Use @ syntax to include files (e.g., '@largefile.js explain what this does') or ask general questions",
  WORKSPACE_TRUST_REQUIRED:
    "Gemini blocked this call because workspace-trust enforcement is enabled and the current directory is not trusted. To resolve, either (a) unset ASK_GEMINI_REQUIRE_WORKSPACE_TRUST so ask-gemini-mcp re-applies its safe default of co-emitting GEMINI_CLI_TRUST_WORKSPACE=true (≥0.42) and GEMINI_TRUST_WORKSPACE=true (≤0.41), (b) export GEMINI_CLI_TRUST_WORKSPACE=true yourself on gemini ≥0.42 (or GEMINI_TRUST_WORKSPACE=true on ≤0.41), (c) pass --skip-trust to gemini for this session (≥0.41), or (d) run `gemini` interactively in this directory once and mark it trusted.",
} as const;

export const STATUS_MESSAGES = {
  QUOTA_SWITCHING: "🚫 Gemini Pro quota exceeded, switching to Flash model...",
  FLASH_RETRY: "⚡ Retrying with Gemini Flash...",
  FLASH_SUCCESS: "✅ Flash model completed successfully",
  SANDBOX_EXECUTING: "🔒 Executing Gemini CLI command in sandbox mode...",
  GEMINI_RESPONSE: "Gemini response:",
  PROCESSING_START: "🔍 Starting analysis (may take 5-15 minutes for large codebases)",
  PROCESSING_CONTINUE: "⏳ Still processing... Gemini is working on your request",
  PROCESSING_COMPLETE: "✅ Analysis completed successfully",
  WORKSPACE_TRUST_DETECTED:
    "🔒 Gemini reported a workspace-trust block; not retrying with Flash (same directory will fail again).",
} as const;

export const MODELS = {
  PRO: process.env.ASK_GEMINI_MODEL || "gemini-3.1-pro-preview",
  FLASH: process.env.ASK_GEMINI_FALLBACK_MODEL || "gemini-3.5-flash",
};

export const CLI = {
  COMMANDS: {
    GEMINI: "gemini",
    ECHO: "echo",
  },
  FLAGS: {
    MODEL: "-m",
    SANDBOX: "-s",
    PROMPT: "-p",
    OUTPUT_FORMAT: "--output-format",
    RESUME: "--resume",
    INCLUDE_DIRECTORIES: "--include-directories",
  },
  OUTPUT_FORMATS: {
    JSON: "json",
    STREAM_JSON: "stream-json",
  },
  DEFAULTS: {
    MODEL: "default",
    BOOLEAN_TRUE: "true",
    BOOLEAN_FALSE: "false",
  },
} as const;

export interface ToolArguments extends BaseToolArguments {
  model?: string;
  sandbox?: boolean | string;
  changeMode?: boolean | string;
  sessionId?: string;
  includeDirs?: string[];
  chunkIndex?: number | string;
  chunkCacheKey?: string;
}
