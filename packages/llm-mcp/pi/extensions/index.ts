import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodexPair } from "./codex-pair.js";
import { registerProviderTools } from "./provider-tools.js";

/**
 * Ask LLM's Pi adapter. The factory only registers tools, commands, and event
 * handlers; provider work, filesystem reads, timers, and child processes start
 * lazily from an explicit tool/command/lifecycle event.
 */
export default function askLlmPiExtension(pi: ExtensionAPI): void {
  registerProviderTools(pi);
  registerCodexPair(pi);
}
