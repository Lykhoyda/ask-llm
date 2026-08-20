import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts", machine: "src/machine.ts", cursor: "src/cursorAgent.ts" },
  format: ["esm"],
  target: "node20",
  sourcemap: true,
  clean: true,
  dts: true,
  fixedExtension: false,
  deps: {
    alwaysBundle: ["@ask-llm/shared"],
    neverBundle: [
      "@ask-llm/gemini-mcp",
      "@ask-llm/codex-mcp",
      "@ask-llm/claude-mcp",
      "@ask-llm/grok-mcp",
      "@ask-llm/ollama-mcp",
      "@ask-llm/antigravity-mcp",
    ],
  },
});
