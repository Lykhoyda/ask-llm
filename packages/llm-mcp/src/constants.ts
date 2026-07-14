export interface ProviderConfig {
  name: string;
  command: string;
  executorModule: string;
  executorFn: string;
  defaultModel: string;
  availabilityModule?: string;
  availabilityFn?: string;
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
    enrichModule: "@ask-llm/codex-mcp/executor",
    enrichFn: "enrichCodexDoctor",
  },
  claude: {
    name: "Claude",
    command: "claude",
    executorModule: "@ask-llm/claude-mcp/executor",
    executorFn: "executeClaudeCLI",
    defaultModel: "opus",
    disabledWhenEnvVar: "CLAUDECODE",
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
    defaultModel: "Gemini 3.1 Pro (High)",
  },
};

export const INSTALL_HINTS: Record<string, string> = {
  gemini: "npm install -g @google/gemini-cli",
  codex: "npm install -g @openai/codex",
  claude: "npm install -g @anthropic-ai/claude-code, then run `claude` once to authenticate",
  ollama: "https://ollama.com — then: ollama pull qwen3.6:27b",
  antigravity: "Install Google Antigravity (agy) from https://antigravity.google, then run `agy` once to log in",
};

export function isProviderEligible(provider: ProviderConfig): boolean {
  return !(provider.disabledWhenEnvVar && process.env[provider.disabledWhenEnvVar]);
}

export function getEligibleProviderKeys(): string[] {
  return Object.entries(PROVIDERS)
    .filter(([, provider]) => isProviderEligible(provider))
    .map(([key]) => key);
}
