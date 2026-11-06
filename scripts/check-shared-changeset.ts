#!/usr/bin/env node
// Private build inputs need an explicit canonical changeset because devDependency bumps do not cascade.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { format } from "oxfmt";

const REQUIRED = ["@ask-llm/mcp"];
const BUNDLED_PACKAGES = [
  "shared",
  "gemini-mcp",
  "codex-mcp",
  "claude-mcp",
  "grok-mcp",
  "ollama-mcp",
  "antigravity-mcp",
];
const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main";

let mergeBase: string;
let changed: string[];
try {
  mergeBase = execFileSync("git", ["merge-base", base, "HEAD"], { encoding: "utf8" }).trim();
  changed = execFileSync("git", ["diff", "--name-only", mergeBase, "HEAD"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
} catch {
  console.error(
    `[shared-changeset] ERROR: cannot diff against ${base} — is the checkout shallow? (fetch-depth: 0 required)`,
  );
  process.exit(1);
}
const formatOptions = JSON.parse(fs.readFileSync(new URL("../.oxfmtrc.json", import.meta.url), "utf8"));
async function isFormattingOnly(file: string): Promise<boolean> {
  if (!fs.existsSync(file)) return false;
  try {
    const before = execFileSync("git", ["show", `${mergeBase}:${file}`], { encoding: "utf8", stdio: "pipe" });
    const formatted = await format(file, before, formatOptions);
    return formatted.errors.length === 0 && formatted.code === fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
}

let bundledChanged = false;
for (const file of changed) {
  if (BUNDLED_PACKAGES.some((name) => file.startsWith(`packages/${name}/src/`)) && !(await isFormattingOnly(file))) {
    bundledChanged = true;
    break;
  }
}
if (!bundledChanged) {
  console.log("[shared-changeset] no bundled src changes — OK");
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
  console.error(`[shared-changeset] bundled source changed but changeset(s) miss: ${missing.join(", ")}`);
  console.error(
    "[shared-changeset] private sources are INLINED into the canonical MCP (ADR-119) — without these bumps the fix never publishes.",
  );
  process.exit(1);
}
console.log(`[shared-changeset] bundled source change covered by changesets for ${REQUIRED.length} canonical MCP — OK`);
