import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerProviderTools } from "./provider-tools.js";

export default function askLlmPiExtension(pi: ExtensionAPI): void {
  registerProviderTools(pi);
}
