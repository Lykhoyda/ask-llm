import { writeFileSync } from "node:fs";

const marker = process.env.ASK_LLM_MACHINE_FIXTURE_LOAD_MARKER;
if (marker) writeFileSync(marker, "loaded\n");

export async function executeCodexCLI() {
  console.info("fixture provider reported a quota failure");
  throw new Error("429 quota exhausted for credential fixture-secret");
}
