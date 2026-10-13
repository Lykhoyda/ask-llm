import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "apps/docs");
const forbidden = /\/plugin install|@ask-llm\/(?:codex|claude|grok|antigravity|ollama|gemini)-mcp|@ask-llm\/plugin/g;
const errors: string[] = [];

function check(path: string) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(forbidden)) {
    const line = source.slice(0, match.index).split("\n").length;
    errors.push(`${relative(root, path)}:${line}: legacy onboarding instruction ${match[0]}`);
  }
}

function walk(directory: string, extension: string, exceptions: boolean) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    // Provider pages are per-provider reference kept unchanged by the S9 plan.
    if (exceptions && ["reference", "providers"].includes(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, extension, false);
    else if (entry.name.endsWith(extension)) check(path);
  }
}

check(join(root, "README.md"));
walk(docs, ".md", true);
walk(join(docs, "public"), ".txt", false);
// Check emitted pages as well: components can introduce instructions absent from Markdown.
walk(join(docs, ".vitepress/dist"), ".html", true);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Onboarding grep passed (Reference/Migration and unchanged provider reference are exempt).");
