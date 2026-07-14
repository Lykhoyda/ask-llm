#!/usr/bin/env node
// CI guard (ADR-119 fallback): the six publishable MCPs embed @ask-llm/shared
// at build time (tsdown), so a shared change MUST ship with a changeset
// covering all six — otherwise the fix silently never reaches npm.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const REQUIRED = [
  "@ask-llm/gemini-mcp",
  "@ask-llm/codex-mcp",
  "@ask-llm/claude-mcp",
  "@ask-llm/ollama-mcp",
  "@ask-llm/antigravity-mcp",
  "@ask-llm/mcp",
];
const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main";

let changed;
try {
  changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
    .split("\n").filter(Boolean);
} catch {
  console.error(`[shared-changeset] ERROR: cannot diff against ${base} — is the checkout shallow? (fetch-depth: 0 required)`);
  process.exit(1);
}
if (!changed.some((f) => f.startsWith("packages/shared/src/"))) {
  console.log("[shared-changeset] no shared src changes — OK");
  process.exit(0);
}
const changesets = changed.filter((f) => f.startsWith(".changeset/") && f.endsWith(".md") && !f.endsWith("README.md"));
const covered = new Set();
for (const f of changesets) {
  if (!fs.existsSync(f)) continue; // deleted in this diff
  const fm = fs.readFileSync(f, "utf8").split("---")[1] ?? "";
  for (const name of REQUIRED) if (fm.includes(`"${name}"`)) covered.add(name);
}
const missing = REQUIRED.filter((n) => !covered.has(n));
if (missing.length > 0) {
  console.error(`[shared-changeset] packages/shared/src changed but changeset(s) miss: ${missing.join(", ")}`);
  console.error("[shared-changeset] shared is INLINED into the MCPs (ADR-119) — without these bumps the fix never publishes.");
  process.exit(1);
}
console.log("[shared-changeset] shared change covered by changesets for all 6 MCPs — OK");
