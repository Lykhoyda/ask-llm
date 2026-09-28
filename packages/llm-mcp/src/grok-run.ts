#!/usr/bin/env node
import { executeGrok } from "@ask-llm/grok-mcp/executor";

const prompt = process.argv.slice(2).join(" ");

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString().trim();
}

async function main(): Promise<void> {
  const stdin = await readStdin();
  if (!prompt && !stdin) {
    console.error("Usage: ask-grok-run <prompt>");
    console.error("       echo 'diff' | ask-grok-run 'Review this diff'");
    process.exit(1);
  }

  try {
    const result = await executeGrok({ prompt: [prompt, stdin].filter(Boolean).join("\n\n") });
    console.log(result.response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ask-grok-run failed: ${message}`);
    process.exit(1);
  }
}

main();
