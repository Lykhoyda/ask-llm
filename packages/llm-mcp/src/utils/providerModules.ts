export async function loadProviderModule(moduleName: string): Promise<Record<string, unknown>> {
  switch (moduleName) {
    case "@ask-llm/gemini-mcp/executor":
      return import("@ask-llm/gemini-mcp/executor");
    case "@ask-llm/codex-mcp/executor":
      return import("@ask-llm/codex-mcp/executor");
    case "@ask-llm/claude-mcp/executor":
      return import("@ask-llm/claude-mcp/executor");
    case "@ask-llm/grok-mcp/executor":
      return import("@ask-llm/grok-mcp/executor");
    case "@ask-llm/ollama-mcp/executor":
      return import("@ask-llm/ollama-mcp/executor");
    case "@ask-llm/antigravity-mcp/executor":
      return import("@ask-llm/antigravity-mcp/executor");
    default:
      throw new Error(`Unknown provider module: ${moduleName}`);
  }
}
