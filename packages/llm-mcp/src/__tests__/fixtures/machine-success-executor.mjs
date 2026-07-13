import { readFileSync, writeFileSync } from "node:fs";

const marker = process.env.ASK_LLM_MACHINE_FIXTURE_LOAD_MARKER;
if (marker) writeFileSync(marker, "loaded\n");

const payload = JSON.parse(readFileSync(new URL("./review-success.json", import.meta.url), "utf8"));

export async function executeCodexCLI() {
  console.log("fixture executor dispatched");
  return {
    response: JSON.stringify(payload),
    model: "gpt-fixture",
    threadId: "thread-fixture-001",
    usage: {
      provider: "codex",
      model: "gpt-fixture",
      inputTokens: 21,
      outputTokens: 13,
      cachedTokens: 0,
      thinkingTokens: 2,
      durationMs: 5,
      fellBack: false,
    },
  };
}
