// Hermetic Pi host model used by scripts/test-pi-package-e2e.mjs.
// It deliberately has no imports so a clean globally-installed Pi can load it.
type ProviderRegistrar = {
  registerProvider(name: string, config: Record<string, unknown>): void;
};

export default function registerScriptedHost(pi: ProviderRegistrar) {
  const port = process.env.ASK_LLM_PI_FAKE_HOST_PORT;
  if (!port) throw new Error("ASK_LLM_PI_FAKE_HOST_PORT is required");
  pi.registerProvider("ask-llm-scripted", {
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
