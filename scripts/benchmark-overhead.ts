/**
 * Static-analysis benchmark: measures token overhead for each deployment approach.
 *
 * NOTE: This script only works inside the dev workspace (yarn workspaces)
 * where @ask-llm/shared, @ask-llm/gemini-mcp, and @ask-llm/codex-mcp resolve as
 * symlinked workspace packages. It will NOT work with published
 * bundledDependencies or after `npm pack`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getEncoding } from "js-tiktoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ── Tokenizer ──────────────────────────────────────────────────────────
const enc = getEncoding("cl100k_base");
function countTokens(text: string): number {
  return enc.encode(text).length;
}

// ── Types ──────────────────────────────────────────────────────────────

interface ToolLike {
  name: string;
  description: string;
  zodSchema: { toJSONSchema?: () => unknown; shape?: unknown };
  annotations?: Record<string, unknown>;
  prompt?: { description: string; arguments?: unknown[] };
  category?: string;
}

interface ToolTokenInfo {
  name: string;
  descriptionTokens: number;
  schemaTokens: number;
  promptTokens: number;
  annotationTokens: number;
  totalTokens: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

function serializeSchema(tool: ToolLike): string {
  if (typeof tool.zodSchema.toJSONSchema === "function") {
    return JSON.stringify(tool.zodSchema.toJSONSchema(), null, 2);
  }
  return JSON.stringify(tool.zodSchema.shape ?? {}, null, 2);
}

function measureTool(tool: ToolLike): ToolTokenInfo {
  const descriptionTokens = countTokens(tool.description);
  const schemaTokens = countTokens(serializeSchema(tool));
  const promptTokens = tool.prompt ? countTokens(JSON.stringify(tool.prompt, null, 2)) : 0;
  const annotationTokens = tool.annotations ? countTokens(JSON.stringify(tool.annotations, null, 2)) : 0;
  const totalTokens = descriptionTokens + schemaTokens + promptTokens + annotationTokens;
  return { name: tool.name, descriptionTokens, schemaTokens, promptTokens, annotationTokens, totalTokens };
}

function readMarkdownFile(relativePath: string): { path: string; content: string; tokens: number } {
  const fullPath = resolve(ROOT, relativePath);
  const content = readFileSync(fullPath, "utf-8");
  return { path: relativePath, content, tokens: countTokens(content) };
}

// ── Table formatting ───────────────────────────────────────────────────

function padRight(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - str.length));
}

function padLeft(str: string | number, len: number): string {
  const s = String(str);
  return " ".repeat(Math.max(0, len - s.length)) + s;
}

function formatTable(headers: string[], rows: (string | number)[][], title?: string): string {
  const colWidths = headers.map((h, i) => {
    const maxData = rows.reduce((max, row) => Math.max(max, String(row[i]).length), 0);
    return Math.max(h.length, maxData);
  });

  const lines: string[] = [];
  if (title) {
    lines.push(`\n${title}`);
    lines.push("=".repeat(colWidths.reduce((s, w) => s + w + 3, -1)));
  }

  lines.push(headers.map((h, i) => (i === 0 ? padRight(h, colWidths[i]) : padLeft(h, colWidths[i]))).join(" | "));
  lines.push(colWidths.map((w) => "-".repeat(w)).join("-+-"));

  for (const row of rows) {
    lines.push(
      row.map((cell, i) => (i === 0 ? padRight(String(cell), colWidths[i]) : padLeft(cell, colWidths[i]))).join(" | "),
    );
  }

  return lines.join("\n");
}

function toMarkdownTable(headers: string[], rows: (string | number)[][]): string {
  const lines: string[] = [];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map((_, i) => (i === 0 ? "---" : "---:")).join(" | ")} |`);
  for (const row of rows) {
    lines.push(`| ${row.join(" | ")} |`);
  }
  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  // Use dynamic imports to avoid ESM/CJS dual-package hazard with tsx.
  // The workspace packages are ESM ("type": "module") and their dist
  // files share a single toolRegistry instance when loaded via dynamic
  // import(), but static `import` in tsx gets transpiled to require()
  // which creates a separate CJS module instance.
  const shared = await import("@ask-llm/shared");
  const { toolRegistry } = shared;

  // Step 1: Snapshot baseline (should be 0 after shared import)
  const baselineCount = toolRegistry.length;

  // Step 2: Import gemini-mcp/register (side-effect: pushes tools)
  await import("@ask-llm/gemini-mcp/register");
  const geminiToolCount = toolRegistry.length - baselineCount;
  const geminiTools = toolRegistry.slice(baselineCount, baselineCount + geminiToolCount) as ToolLike[];

  // Step 3: Import codex-mcp/register (side-effect: pushes tools)
  const preCodexCount = toolRegistry.length;
  await import("@ask-llm/codex-mcp/register");
  const codexToolCount = toolRegistry.length - preCodexCount;
  const codexTools = toolRegistry.slice(preCodexCount, preCodexCount + codexToolCount) as ToolLike[];

  // Step 4: Measure each tool
  const geminiMeasurements = geminiTools.map(measureTool);
  const codexMeasurements = codexTools.map(measureTool);
  const allMeasurements = [...geminiMeasurements, ...codexMeasurements];

  // Step 5: Read markdown files
  const skillMd = readMarkdownFile("packages/claude-plugin/skills/gemini-review/SKILL.md");
  const agentMd = readMarkdownFile("packages/claude-plugin/agents/gemini-reviewer.md");

  // ── Per-tool detail table ──
  const detailHeaders = ["Tool", "Description", "Schema", "Prompt", "Annotations", "Total"];
  const detailRows = allMeasurements.map((m) => [
    m.name,
    m.descriptionTokens,
    m.schemaTokens,
    m.promptTokens,
    m.annotationTokens,
    m.totalTokens,
  ]);

  const detailTable = formatTable(detailHeaders, detailRows, "Per-Tool Token Breakdown");

  // ── Markdown files table ──
  const mdHeaders = ["File", "Tokens"];
  const mdRows: (string | number)[][] = [
    [skillMd.path, skillMd.tokens],
    [agentMd.path, agentMd.tokens],
  ];
  const mdTable = formatTable(mdHeaders, mdRows, "Markdown Context Files");

  // ── Approach totals ──
  const geminiTotal = geminiMeasurements.reduce((s, m) => s + m.totalTokens, 0);
  const codexTotal = codexMeasurements.reduce((s, m) => s + m.totalTokens, 0);
  const orchestratorTotal = geminiTotal + codexTotal;
  const skillTotal = geminiTotal + skillMd.tokens + agentMd.tokens;
  const subagentTotal = agentMd.tokens + geminiTotal;

  const approachHeaders = ["Approach", "Tools", "Tool Tokens", "MD Tokens", "Total Tokens"];
  const approachRows: (string | number)[][] = [
    ["Standalone Gemini (@ask-llm/gemini-mcp)", geminiToolCount, geminiTotal, 0, geminiTotal],
    ["Standalone Codex (@ask-llm/codex-mcp)", codexToolCount, codexTotal, 0, codexTotal],
    ["Orchestrator (@ask-llm/mcp)", geminiToolCount + codexToolCount, orchestratorTotal, 0, orchestratorTotal],
    ["Skill (/gemini-review)", geminiToolCount, geminiTotal, skillMd.tokens + agentMd.tokens, skillTotal],
    ["Subagent (gemini-reviewer)", geminiToolCount, geminiTotal, agentMd.tokens, subagentTotal],
  ];
  const approachTable = formatTable(approachHeaders, approachRows, "Per-Approach Token Overhead");

  // ── Print to stdout ──
  const output = [detailTable, mdTable, approachTable].join("\n\n");
  console.log(output);
  console.log(`\nGenerated at: ${new Date().toISOString()}`);

  // ── Write docs/benchmarks/overhead.md ──
  const mdContent = [
    "# Token Overhead Benchmark",
    "",
    "Static analysis of per-approach context-window overhead.",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Per-Tool Token Breakdown",
    "",
    toMarkdownTable(detailHeaders, detailRows),
    "",
    "## Markdown Context Files",
    "",
    toMarkdownTable(mdHeaders, mdRows),
    "",
    "## Per-Approach Token Overhead",
    "",
    toMarkdownTable(approachHeaders, approachRows),
    "",
    "## Notes",
    "",
    "- Tokenizer: `cl100k_base` (js-tiktoken) — close proxy for Claude's tokenizer",
    "- Tool tokens include: description + JSON schema + prompt metadata + annotations",
    "- Skill totals include the SKILL.md and agent .md loaded into the primary context",
    "- Subagent total reflects the agent .md + tools available in the spawned subagent context",
    "- Orchestrator registers both Gemini and Codex tools in a single server",
    "",
  ].join("\n");

  const outDir = resolve(ROOT, "docs", "benchmarks");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "overhead.md"), mdContent, "utf-8");
  console.log(`\nWrote: docs/benchmarks/overhead.md`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
