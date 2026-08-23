export const XAI_API_KEY_ENV = "XAI_API_KEY";
export const XAI_API_BASE_URL = "https://api.x.ai";

// Exact public API identifier documented by xAI. Reasoning effort is a
// request parameter, not a different model identifier.
export const FACTORY_DEFAULT_MODEL = "grok-4.6";
export const GROK_CLI_FACTORY_DEFAULT_MODEL = "grok-build";
export const FACTORY_DEFAULT_REASONING_EFFORT = "high";
export const FACTORY_MAX_OUTPUT_TOKENS = 16_384;
export const GROK_HARNESSES = ["xai-api", "grok-cli"] as const;
export type GrokHarness = (typeof GROK_HARNESSES)[number];
export const FACTORY_DEFAULT_HARNESS: GrokHarness = "xai-api";

export const MODELS = {
  DEFAULT: process.env.ASK_GROK_MODEL || FACTORY_DEFAULT_MODEL,
} as const;

export const API = {
  RESPONSES: "/v1/responses",
  MODELS: "/v1/models",
} as const;

export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export const REASONING_DOCS_URL = "https://docs.x.ai/developers/model-capabilities/text/reasoning";
export type GrokReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const ERROR_MESSAGES = {
  NO_PROMPT_PROVIDED: "Please provide a prompt for analysis. Ask a question or describe the code you want reviewed.",
  MISSING_CREDENTIALS:
    "Grok authentication is not configured. Set XAI_API_KEY to an xAI API key from https://console.x.ai/team/default/api-keys. xAI API billing is separate and may incur usage charges.",
  MISSING_CREDENTIALS_CLI_DETECTED:
    'XAI_API_KEY is not configured, so the default xai-api harness cannot run, but an authenticated Grok CLI with headless JSON support was detected. Ask LLM never falls back between harnesses: pin harness "grok-cli" on this request, or set ASK_GROK_HARNESS=grok-cli to make the CLI the default, or set XAI_API_KEY to use the xAI API.',
  INVALID_CREDENTIALS:
    "Grok authentication failed. Verify XAI_API_KEY and the key's xAI team permissions. The key was not logged or returned.",
  RATE_LIMITED:
    "Grok API quota, credits, or rate limit was exhausted. Check the xAI Console billing and rate-limit pages. Ask LLM does not buy credits, enable billing, request paid capacity, or fall back to another model.",
  SAFETY_REFUSAL:
    "Grok refused the request for safety or usage-guideline reasons. Revise the prompt or review xAI's usage guidelines. No fallback was attempted.",
  MALFORMED_RESPONSE:
    "Grok API returned a malformed response without usable output. Retry once, then inspect xAI service status if it persists. No fallback was attempted.",
} as const;

export const STATUS_MESSAGES = {
  GROK_RESPONSE: "Grok response:",
} as const;

export const MODEL_DISCOVERY_TIMEOUT_MS = 5000;
