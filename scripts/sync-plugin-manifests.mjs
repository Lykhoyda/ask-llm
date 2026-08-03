#!/usr/bin/env node
// Mirror packages/claude-plugin/package.json `version` into the two other
// manifests that carry the same version field:
//   - packages/claude-plugin/.claude-plugin/plugin.json (read by Claude Code)
//   - .claude-plugin/marketplace.json (the marketplace listing)
//
// Run automatically after `yarn changeset version` via the `changeset:version`
// composed script. `--check` is used by lint/CI to fail without modifying files
// if a release-preparation change bypasses that command.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "packages/claude-plugin/package.json");
const PLUGIN_JSON = resolve(ROOT, "packages/claude-plugin/.claude-plugin/plugin.json");
const MARKETPLACE_JSON = resolve(ROOT, ".claude-plugin/marketplace.json");
const PLUGIN_NAME = "ask-llm";
const CHECK_ONLY = process.argv.includes("--check");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function syncPluginJson(version) {
  const pluginJson = await readJson(PLUGIN_JSON);
  if (pluginJson.version === version) return false;
  if (!CHECK_ONLY) {
    pluginJson.version = version;
    await writeJson(PLUGIN_JSON, pluginJson);
  }
  return true;
}

async function syncMarketplaceJson(version) {
  const marketplace = await readJson(MARKETPLACE_JSON);
  const entry = marketplace.plugins?.find((p) => p.name === PLUGIN_NAME);
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

async function main() {
  const source = await readJson(SOURCE);
  const version = source.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`${SOURCE}: missing "version" field`);
  }

  const pluginChanged = await syncPluginJson(version);
  const marketplaceChanged = await syncMarketplaceJson(version);

  const changed = [
    pluginChanged ? "plugin.json" : null,
    marketplaceChanged ? "marketplace.json" : null,
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

main().catch((err) => {
  console.error(`sync-plugin-manifests: ${err.message}`);
  process.exit(1);
});
