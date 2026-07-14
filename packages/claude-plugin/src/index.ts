export interface ProviderExecutor {
  name: string;
  command: string;
  execute(prompt: string, options?: Record<string, unknown>): Promise<string>;
}

export const providers: ProviderExecutor[] = [
  {
    name: "gemini",
    command: "gemini",
    async execute(prompt: string) {
      const { executeGeminiCLI } = await import("@ask-llm/gemini-mcp/executor");
      const result = await executeGeminiCLI({ prompt });
      return result.response;
    },
  },
  {
    name: "codex",
    command: "codex",
    async execute(prompt: string) {
      const { executeCodexCLI } = await import("@ask-llm/codex-mcp/executor");
      const result = await executeCodexCLI({ prompt });
      return result.response;
    },
  },
  {
    name: "ollama",
    command: "ollama",
    async execute(prompt: string) {
      const { executeOllamaCLI } = await import("@ask-llm/ollama-mcp/executor");
      const result = await executeOllamaCLI({ prompt });
      return result.response;
    },
  },
  {
    name: "antigravity",
    command: "agy",
    async execute(prompt: string) {
      const { executeAntigravityCLI } = await import("@ask-llm/antigravity-mcp/executor");
      const result = await executeAntigravityCLI({ prompt });
      return result.response;
    },
  },
];
