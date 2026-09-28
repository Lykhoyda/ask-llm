import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import askLlmPiExtension from "@ask-llm/mcp/pi";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function askLlmBridge(pi: ExtensionAPI): void {
  askLlmPiExtension(pi);
  pi.on("resources_discover", () => {
    const require = createRequire(import.meta.url);
    const manifestPath = require.resolve("@ask-llm/mcp/package.json");
    const manifest = require(manifestPath) as { pi: { skills: string[] } };
    return { skillPaths: manifest.pi.skills.map((path) => resolve(dirname(manifestPath), path)) };
  });
}
