import { createRequire } from "node:module";

export function readPackageJson(): { name: string; version: string } {
  try {
    const require = createRequire(import.meta.url);
    return require("../package.json") as { name: string; version: string };
  } catch {
    return { name: "@ask-llm/mcp", version: "0.0.0" };
  }
}
