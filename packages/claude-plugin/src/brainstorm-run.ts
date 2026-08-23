#!/usr/bin/env node
import { parseBrainstormParticipantList, runBrainstormPanel } from "./brainstorm-panel.js";

function parseArgs(argv: string[]): string[] {
  const participants: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--participant") {
      const value = argv[index + 1];
      if (!value) throw new Error("--participant requires provider@harness:exact-model-id");
      participants.push(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument "${arg}". Only repeated --participant arguments are supported.`);
  }
  return participants;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

async function main(): Promise<void> {
  try {
    const specs = parseArgs(process.argv.slice(2));
    const list = parseBrainstormParticipantList(specs);
    if (list.mode !== "exact") {
      throw new Error(
        `ask-brainstorm-run executes only the exact routed Grok + GPT-5.6 Sol panel; bare providers (${list.providers.join(", ")}) use the standard coordinator dispatch. No participant was dispatched.`,
      );
    }
    const prompt = await readStdin();
    const report = await runBrainstormPanel({
      prompt,
      participants: list.participants,
      onProgress: (message) => console.error(message),
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "complete") process.exitCode = 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ask-brainstorm-run failed: ${message}`);
    process.exitCode = 1;
  }
}

main();
