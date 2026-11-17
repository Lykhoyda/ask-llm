#!/usr/bin/env node
// Mirror the plugin package version to plugin.json, marketplace.json and the server pin in each plugin
// MCP definition after changesets versioning. Lint uses `--check` to reject stale release metadata, an
// MCP definition that does not start the pinned server directly, and a skill corpus that disagrees
// with its manifests.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "packages/llm-mcp/package.json");
const PLUGIN_JSON = resolve(ROOT, "packages/llm-mcp/.claude-plugin/plugin.json");
const CURSOR_PLUGIN_JSON = resolve(ROOT, "packages/llm-mcp/.cursor-plugin/plugin.json");
const MARKETPLACE_JSON = resolve(ROOT, ".claude-plugin/marketplace.json");
// Each plugin MCP definition runs `node <plugin root>/scripts/plugin-mcp-server.mjs <server> <version>`.
export const MCP_DEFINITIONS = [
  { file: "packages/llm-mcp/.mcp.json", server: "codex", rootVariable: "CLAUDE_PLUGIN_ROOT" },
  { file: "packages/llm-mcp/mcp.json", server: "ask-llm", rootVariable: "CURSOR_PLUGIN_ROOT" },
] as const;
const PLUGIN_NAME = "ask-llm";
const CHECK_ONLY = process.argv.includes("--check");

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path: string, data: unknown) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function syncPluginJson(path: string, version: string) {
  const pluginJson = await readJson(path);
  if (pluginJson.version === version) return false;
  if (!CHECK_ONLY) {
    pluginJson.version = version;
    await writeJson(path, pluginJson);
  }
  return true;
}

async function syncMarketplaceJson(version: string) {
  const marketplace = await readJson(MARKETPLACE_JSON);
  const entry = marketplace.plugins?.find((p: { name: string }) => p.name === PLUGIN_NAME);
  if (!entry) {
    throw new Error(`marketplace.json: no plugin entry named "${PLUGIN_NAME}"`);
  }
  if (entry.version === version) return false;
  if (!CHECK_ONLY) {
    entry.version = version;
    await writeJson(MARKETPLACE_JSON, marketplace);
  }
  return true;
}

type McpDefinition = (typeof MCP_DEFINITIONS)[number];

// Returns the definition's pinned version, or throws when it no longer starts the server directly.
export function mcpDefinitionPin(definition: McpDefinition, config: unknown): string {
  const servers = (config as { mcpServers?: Record<string, unknown> } | null)?.mcpServers;
  const names = servers && typeof servers === "object" ? Object.keys(servers) : [];
  const entry = servers?.[definition.server] as { command?: unknown; args?: unknown } | undefined;
  const args = Array.isArray(entry?.args) ? entry.args : [];
  const launcher = `\${${definition.rootVariable}}/scripts/plugin-mcp-server.mjs`;
  if (
    names.length !== 1 ||
    entry?.command !== "node" ||
    args.length !== 3 ||
    args[0] !== launcher ||
    args[1] !== definition.server ||
    typeof args[2] !== "string"
  ) {
    throw new Error(
      `${definition.file}: must hold only "${definition.server}" running node ${launcher} ${definition.server} <version>`,
    );
  }
  return args[2];
}

// Returns the definition pinned to `version`, or null when it already is.
export function pinMcpDefinition<T>(definition: McpDefinition, config: T, version: string): T | null {
  if (mcpDefinitionPin(definition, config) === version) return null;
  // mcpDefinitionPin has validated the shape, so the entry and its three arguments exist.
  const pinned = structuredClone(config) as { mcpServers: Record<string, { args: string[] }> };
  (pinned.mcpServers[definition.server] as { args: string[] }).args[2] = version;
  return pinned as T;
}

async function syncMcpDefinition(definition: McpDefinition, version: string) {
  const path = resolve(ROOT, definition.file);
  const pinned = pinMcpDefinition(definition, await readJson(path), version);
  if (!pinned) return false;
  if (!CHECK_ONLY) await writeJson(path, pinned);
  return true;
}

function frontmatterName(file: string): string | undefined {
  return /^---\n(?:.*\n)*?name: (.+)\n/.exec(readFileSync(file, "utf8"))?.[1]?.trim();
}

export function skillAgreementErrors(root: string): string[] {
  const pkgDir = join(root, "packages/llm-mcp");
  const skillsDir = join(pkgDir, "skills");
  const errors: string[] = [];
  for (const folder of readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const file = join(skillsDir, folder.name, "SKILL.md");
    const name = existsSync(file) ? frontmatterName(file) : undefined;
    if (name !== folder.name) errors.push(`skills/${folder.name}: frontmatter name is ${name ?? "missing"}`);
    if (folder.name.startsWith("ask-llm-") || !existsSync(file)) continue;
    const target = /\.\.\/(ask-llm-[a-z0-9-]+)\/SKILL\.md/.exec(readFileSync(file, "utf8"))?.[1];
    if (!target || !existsSync(join(skillsDir, target, "SKILL.md")))
      errors.push(`skills/${folder.name}: points at missing ../${target ?? "ask-llm-<name>"}/SKILL.md`);
  }
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  if (pkg.pi?.skills) errors.push("package.json pi: declares skills; Pi reads them from ~/.agents/skills");
  if (!pkg.files?.includes("skills/")) errors.push("package.json files: skills/ is not packed");
  const cursor = JSON.parse(readFileSync(join(pkgDir, ".cursor-plugin/plugin.json"), "utf8"));
  for (const entry of cursor.skills ?? []) {
    if (!existsSync(join(pkgDir, entry, "SKILL.md")))
      errors.push(`.cursor-plugin/plugin.json: ${entry} has no SKILL.md`);
  }
  const pin = /SKILLS_CLI_VERSION = "([^"]+)"/.exec(readFileSync(join(pkgDir, "src/skills.ts"), "utf8"))?.[1];
  const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  const pins = [...ci.matchAll(/npx -y skills@([^\s]+)/g)].map((match) => match[1]);
  if (!pin || pins.length === 0 || pins.some((version) => version !== pin))
    errors.push(`ci.yml: the Pi smoke must seed skills with skills@${pin}`);
  return errors;
}

async function main() {
  const source = await readJson(SOURCE);
  const version = source.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`${SOURCE}: missing "version" field`);
  }

  const skillErrors = skillAgreementErrors(ROOT);
  if (skillErrors.length > 0)
    throw new Error(`skill corpus disagrees with its manifests:\n  ${skillErrors.join("\n  ")}`);

  const pluginChanged = await syncPluginJson(PLUGIN_JSON, version);
  const cursorPluginChanged = await syncPluginJson(CURSOR_PLUGIN_JSON, version);
  const marketplaceChanged = await syncMarketplaceJson(version);
  const mcpChanged: string[] = [];
  for (const definition of MCP_DEFINITIONS) {
    if (await syncMcpDefinition(definition, version)) mcpChanged.push(definition.file);
  }

  const changed = [
    pluginChanged ? ".claude-plugin/plugin.json" : null,
    cursorPluginChanged ? ".cursor-plugin/plugin.json" : null,
    marketplaceChanged ? "marketplace.json" : null,
    ...mcpChanged,
  ].filter(Boolean);

  if (CHECK_ONLY && changed.length > 0) {
    throw new Error(`${changed.join(", ")} must match package.json version ${version}; run yarn changeset:version`);
  }
  if (changed.length > 0) {
    console.log(`sync-plugin-manifests: synced ${version} to ${changed.join(", ")}`);
  } else {
    console.log(`sync-plugin-manifests: all manifests match ${version}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`sync-plugin-manifests: ${err.message}`);
    process.exit(1);
  });
}
