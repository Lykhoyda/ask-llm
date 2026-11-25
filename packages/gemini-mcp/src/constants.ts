import type { BaseToolArguments } from "@ask-llm/shared";

export const QUOTA_PATTERNS = ["RESOURCE_EXHAUSTED", "TerminalQuotaError", "exhausted your capacity"] as const;

export const WORKSPACE_TRUST_PATTERNS = ["FatalUntrustedWorkspaceError", "not running in a trusted directory"] as const;

// #140: Gemini CLI free/Pro/Ultra backend cutoff (2026-06-18). Error classes
// used by the date-gated tier-discontinuation enricher. tierAccess = "your
// account/tier can't use this" (the post-cutoff signature); quota stays the
// narrow Flash-fallback trigger. Patterns are word-boundary matched in
// classifyGeminiCliError and only drive the advisory note, never the fallback.
// Restricted to high-confidence auth/access signals (PR #147 review): broad
// terms (Standard/Enterprise/billing/subscription/"not available") were dropped
// because they false-positive on generic 503/service errors post-cutoff; the
// real tier-cutoff failure is a 403/PERMISSION_DENIED, already captured here.
export const TIER_ACCESS_PATTERNS = [
  "403",
  "PERMISSION_DENIED",
  "401",
  "UNAUTHENTICATED",
  "forbidden",
  "unauthorized",
  "not authorized",
  "access denied",
  "does not have access",
  "not permitted",
  "Code Assist",
] as const;

export const OPERATIONAL_PATTERNS = [
  "timed out",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "Unexpected token",
  "is not valid JSON",
] as const;

// Explicit UTC instant — NOT new Date("2026-06-18"), which is UTC-midnight and
// can fire June 17 in negative-offset timezones. Override via ASK_GEMINI_TIER_CUTOFF.
export const GEMINI_TIER_CUTOFF_DEFAULT = "2026-06-18T00:00:00Z";

// Stable header used as the prepend marker (idempotency) and the user-facing lead.
export const TIER_NOTE_MARKER = "Gemini CLI tier change (2026-06-18)";

export const ERROR_MESSAGES = {
  QUOTA_EXCEEDED: "RESOURCE_EXHAUSTED",
  QUOTA_EXCEEDED_SHORT: "⚠️ Gemini Pro daily quota exceeded. Please retry with model: 'gemini-3.8-flash'",
  TOOL_NOT_FOUND: "not found in registry",
  NO_PROMPT_PROVIDED:
    "Please provide a prompt for analysis. Use @ syntax to include files (e.g., '@largefile.js explain what this does') or ask general questions",
  WORKSPACE_TRUST_REQUIRED:
    "Gemini blocked this call because workspace-trust enforcement is enabled and the current directory is not trusted. To resolve, either (a) unset ASK_GEMINI_REQUIRE_WORKSPACE_TRUST so @ask-llm/gemini-mcp re-applies its safe default of co-emitting GEMINI_CLI_TRUST_WORKSPACE=true (≥0.42) and GEMINI_TRUST_WORKSPACE=true (≤0.41), (b) export GEMINI_CLI_TRUST_WORKSPACE=true yourself on gemini ≥0.42 (or GEMINI_TRUST_WORKSPACE=true on ≤0.41), (c) pass --skip-trust to gemini for this session (≥0.41), or (d) run `gemini` interactively in this directory once and mark it trusted.",
  TIER_DISCONTINUED:
    '⚠️ Gemini CLI tier change (2026-06-18). Google ended individual access, including free, Google AI Pro, and Ultra, on 2026-06-18. Gemini CLI requires an existing, eligible Gemini Code Assist Standard or Enterprise seat. Google ended new subscription purchases on 2026-10-09. Existing subscriptions auto-renew through 2026, and automatic renewal ends in 2027. Account eligibility is one possible cause of the error below. Check the original error for authentication, billing, or quota details. If you choose Antigravity, use the ask-llm tool with provider "antigravity" after reviewing Google\'s consumer-plan terms and the local opt-in requirements at https://lykhoyda.github.io/ask-llm/providers/antigravity. Other options include ask-codex and ask-ollama. See https://lykhoyda.github.io/ask-llm/providers/gemini for seat eligibility.',
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

// The out-of-box default, independent of any ASK_GEMINI_MODEL override —
// tool descriptions and drift-guard tests reference this, not the live value.
export const FACTORY_DEFAULT_MODEL = "gemini-4-argon";

export const MODELS = {
  PRO: process.env.ASK_GEMINI_MODEL || FACTORY_DEFAULT_MODEL,
  FLASH: process.env.ASK_GEMINI_FALLBACK_MODEL || "gemini-3.8-flash",
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
