export interface ProviderConfig {
  name: string;
  command: string;
  executorModule: string;
  executorFn: string;
  defaultModel: string;
  modelEnvVar?: string;
  availabilityModule?: string;
  availabilityFn?: string;
  availabilitySuccess?: string;
  availabilityFailure?: string;
  supportProbeModule?: string;
  supportProbeFn?: string;
  versionAssessmentModule?: string;
  versionAssessmentFn?: string;
  enrichModule?: string;
  enrichFn?: string;
  disabledWhenEnvVar?: string;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  gemini: {
    name: "Gemini",
    command: "gemini",
    executorModule: "@ask-llm/gemini-mcp/executor",
    executorFn: "executeGeminiCLI",
    defaultModel: "gemini-3.1-pro-preview",
  },
  codex: {
    name: "Codex",
    command: "codex",
    executorModule: "@ask-llm/codex-mcp/executor",
    executorFn: "executeCodexCLI",
    defaultModel: "gpt-5.6-sol",
    modelEnvVar: "ASK_CODEX_MODEL",
    enrichModule: "@ask-llm/codex-mcp/executor",
    enrichFn: "enrichCodexDoctor",
  },
  claude: {
    name: "Claude",
    command: "claude",
    executorModule: "@ask-llm/claude-mcp/executor",
    executorFn: "executeClaudeCLI",
    defaultModel: "opus",
    modelEnvVar: "ASK_CLAUDE_MODEL",
    disabledWhenEnvVar: "CLAUDECODE",
  },
  grok: {
    name: "Grok",
    command: "xai-api",
    executorModule: "@ask-llm/grok-mcp/executor",
    executorFn: "executeGrok",
    defaultModel: "grok-4.6",
    modelEnvVar: "ASK_GROK_MODEL",
    availabilityModule: "@ask-llm/grok-mcp/executor",
    availabilityFn: "isGrokProviderAvailable",
    availabilitySuccess: "XAI_API_KEY is configured (no inference request made)",
    availabilityFailure: "XAI_API_KEY is not configured",
  },
  ollama: {
    name: "Ollama",
    command: "ollama",
    executorModule: "@ask-llm/ollama-mcp/executor",
    executorFn: "executeOllamaCLI",
    defaultModel: "qwen3.6:27b",
    availabilityModule: "@ask-llm/ollama-mcp/executor",
    availabilityFn: "isProviderAvailable",
  },
  antigravity: {
    name: "Antigravity",
    command: "agy",
    executorModule: "@ask-llm/antigravity-mcp/executor",
    executorFn: "executeAntigravityCLI",
    defaultModel: "gemini-3.1-pro",
    modelEnvVar: "ASK_ANTIGRAVITY_MODEL",
    supportProbeModule: "@ask-llm/antigravity-mcp/executor",
    supportProbeFn: "probeAgySupport",
    versionAssessmentModule: "@ask-llm/antigravity-mcp/executor",
    versionAssessmentFn: "assessAgyVersion",
  },
};

export const INSTALL_HINTS: Record<string, string> = {
  gemini: "npm install -g @google/gemini-cli",
  codex: "npm install -g @openai/codex",
  claude: "npm install -g @anthropic-ai/claude-code, then run `claude` once to authenticate",
  grok: "Set XAI_API_KEY from https://console.x.ai/team/default/api-keys (metered xAI API; Ask LLM never enables billing or credits)",
  ollama: "https://ollama.com — then: ollama pull qwen3.6:27b",
  antigravity:
    "Install Google Antigravity (agy) >=1.1.5 from https://antigravity.google, verify with `agy --version`, then run `agy` once to log in",
};

export function isProviderEligible(provider: ProviderConfig): boolean {
  return !(provider.disabledWhenEnvVar && process.env[provider.disabledWhenEnvVar]);
}

export function getEligibleProviderKeys(): string[] {
  return Object.entries(PROVIDERS)
    .filter(([, provider]) => isProviderEligible(provider))
    .map(([key]) => key);
}
