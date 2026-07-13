import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  sourcemap: true,
  clean: true,
  dts: true,
  fixedExtension: false,
  deps: {
    alwaysBundle: ["@ask-llm/shared"],
    neverBundle: ["ask-gemini-mcp", "ask-codex-mcp", "@anton-lykhoyda/ask-claude-mcp", "ask-ollama-mcp", "ask-antigravity-mcp"],
  },
});
