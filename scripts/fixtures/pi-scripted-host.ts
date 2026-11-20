// Hermetic Pi host model used by scripts/test-pi-package-e2e.ts.
// It deliberately has no imports so a clean globally-installed Pi can load it.
type ProviderRegistrar = {
  on(
    name: "tool_call",
    handler: (event: { toolName: string; input: { path?: unknown } }) => Promise<void>,
  ): void;
  registerProvider(name: string, config: Record<string, unknown>): void;
  registerCommand(
    name: string,
    command: {
      description: string;
      handler: (args: string, ctx: { reload(): Promise<void> }) => Promise<void>;
    },
  ): void;
};

export default function registerScriptedHost(pi: ProviderRegistrar) {
  const port = process.env.ASK_LLM_PI_FAKE_HOST_PORT;
  if (!port) throw new Error("ASK_LLM_PI_FAKE_HOST_PORT is required");
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "write" || !String(event.input.path).includes("paired-race")) return;
    const response = await fetch(`http://127.0.0.1:${port}/hold-write`, {
      method: "POST",
      body: JSON.stringify({ path: event.input.path }),
      signal: AbortSignal.timeout(10_000),
    });
    await response.text();
  });
  pi.registerCommand("smoke-reload", {
    description: "Reload the isolated Pi test extension",
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
  // Exercise both the custom provider and the exact native identity strings
  // in Pi's event contexts. Every selectable fixture model goes to loopback.
  for (const provider of ["ask-llm-scripted", "openai", "openai-codex", "anthropic", "xai"]) {
    pi.registerProvider(provider, {
      name: "Ask LLM scripted CI host",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "hermetic-test-key",
      api: "openai-completions",
      models: [
        {
          id: "scripted",
          name: "Scripted",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096,
        },
      ],
    });
  }
}
