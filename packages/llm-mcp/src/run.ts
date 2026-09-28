#!/usr/bin/env node
import { executeGeminiCLI } from "@ask-llm/gemini-mcp/executor";

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
    console.error("Usage: ask-gemini-run <prompt>");
    console.error("       echo 'diff' | ask-gemini-run 'Review this diff'");
    process.exit(1);
  }

  const fullPrompt = [prompt, stdin].filter(Boolean).join("\n\n");

  try {
    const result = await executeGeminiCLI({ prompt: fullPrompt });
    console.log(result.response);
  } catch (error) {
    console.error("ask-gemini-run failed:", error);
    process.exit(1);
  }
}

main();
