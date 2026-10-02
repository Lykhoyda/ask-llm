import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodexPair } from "./codex-pair.js";
import { registerProviderTools } from "./provider-tools.js";
import { registerSkillsNotice } from "./skills-notice.js";

export default async function askLlmPiExtension(pi: ExtensionAPI): Promise<void> {
  await registerProviderTools(pi);
  registerCodexPair(pi);
  registerSkillsNotice(pi);
}
