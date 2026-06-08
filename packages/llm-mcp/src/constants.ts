export interface ProviderConfig {
  name: string;
  command: string;
  executorModule: string;
  executorFn: string;
  defaultModel: string;
  availabilityModule?: string;
  availabilityFn?: string;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  gemini: {
    name: "Gemini",
    command: "gemini",
    executorModule: "ask-gemini-mcp/executor",
    executorFn: "executeGeminiCLI",
    defaultModel: "gemini-3.1-pro-preview",
  },
  codex: {
    name: "Codex",
    command: "codex",
    executorModule: "ask-codex-mcp/executor",
    executorFn: "executeCodexCLI",
    defaultModel: "gpt-5.5",
  },
  ollama: {
    name: "Ollama",
    command: "ollama",
    executorModule: "ask-ollama-mcp/executor",
    executorFn: "executeOllamaCLI",
    defaultModel: "qwen2.5-coder:7b",
    availabilityModule: "ask-ollama-mcp/executor",
    availabilityFn: "isProviderAvailable",
  },
  antigravity: {
    name: "Antigravity",
    command: "agy",
    executorModule: "ask-antigravity-mcp/executor",
    executorFn: "executeAntigravityCLI",
    defaultModel: "Gemini 3.5 Flash (High)",
  },
};

export const INSTALL_HINTS: Record<string, string> = {
  gemini: "npm install -g @google/gemini-cli",
  codex: "npm install -g @openai/codex",
  ollama: "https://ollama.com — then: ollama pull qwen2.5-coder:7b",
  antigravity: "Install Google Antigravity (agy) from https://antigravity.google, then run `agy` once to log in",
};
