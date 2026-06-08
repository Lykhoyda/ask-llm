#!/usr/bin/env node
import { executeAntigravityCLI } from "ask-antigravity-mcp/executor";

const args = process.argv.slice(2);
const prompt = args.join(" ");

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString().trim();
}

async function main(): Promise<void> {
  const stdin = await readStdin();

  if (!prompt && !stdin) {
    console.error("Usage: ask-antigravity-run <prompt>");
    console.error("       echo 'diff' | ask-antigravity-run 'Review this diff'");
    process.exit(1);
  }

  const fullPrompt = [prompt, stdin].filter(Boolean).join("\n\n");

  try {
    const result = await executeAntigravityCLI({ prompt: fullPrompt });
    console.log(result.response);
  } catch (error) {
    console.error("ask-antigravity-run failed:", error);
    process.exit(1);
  }
}

main();
