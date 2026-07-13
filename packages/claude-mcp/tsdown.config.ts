import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    executor: "src/utils/claudeExecutor.ts",
    register: "src/tools/index.ts",
  },
  format: ["esm"],
  target: "node20",
  fixedExtension: false,
  sourcemap: true,
  clean: true,
  dts: true,
  deps: { alwaysBundle: ["@ask-llm/shared"] },
});
