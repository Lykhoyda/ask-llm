#!/usr/bin/env node
/**
 * Preflight gate (ADR-107, simplified + strengthened by ADR-119): assert the
 * manifest each publishable package would publish to npm is clean.
 *
 * Since ADR-119 there is NO pack-time manifest mutation — what's in source IS
 * what npm publishes. The gate statically asserts, per publishable package:
 *   1. no `workspace:` literal in dependencies/peerDependencies/optionalDependencies
 *      (the ADR-052 npm-9 EUNSUPPORTEDPROTOCOL class — devDependencies are
 *      exempt: npm ignores them on install);
 *   2. no `bundledDependencies`/`bundleDependencies` field at all
 *      (the #115 npm-11 global-install class);
 *   3. no `prepack`/`postpack` scripts (nothing may mutate the manifest again).
 *
 * Run locally: node scripts/preflight-no-workspace-protocol.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEPS_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];
const CANONICAL_PACKAGES = {
  "antigravity-mcp": { name: "@ask-llm/antigravity-mcp", bins: ["ask-antigravity-mcp"] },
  "claude-mcp": { name: "@ask-llm/claude-mcp", bins: ["ask-claude-mcp"] },
  "claude-plugin": {
    name: "@ask-llm/plugin",
    bins: [
      "ask-antigravity-run",
      "ask-brainstorm-run",
      "ask-codex-run",
      "ask-gemini-run",
      "ask-grok-run",
      "ask-ollama-run",
    ],
  },
  "codex-mcp": { name: "@ask-llm/codex-mcp", bins: ["ask-codex-mcp"] },
  "gemini-mcp": { name: "@ask-llm/gemini-mcp", bins: ["ask-gemini-mcp"] },
  "grok-mcp": { name: "@ask-llm/grok-mcp", bins: ["ask-grok-mcp"] },
  "llm-mcp": { name: "@ask-llm/mcp", bins: ["ask-llm-mcp"] },
  "ollama-mcp": { name: "@ask-llm/ollama-mcp", bins: ["ask-ollama-mcp"] },
};
const MCP_REGISTRY_MANIFESTS = [
  "server.json",
  "packages/antigravity-mcp/server.json",
  "packages/claude-mcp/server.json",
  "packages/codex-mcp/server.json",
  "packages/grok-mcp/server.json",
  "packages/llm-mcp/server.json",
  "packages/ollama-mcp/server.json",
];

function findPublishablePackages() {
  const packagesDir = path.join(REPO_ROOT, "packages");
  const out = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = path.join(packagesDir, entry.name, "package.json");
    if (!fs.existsSync(p)) continue;
    const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
    if (pkg.private === true) continue;
    out.push({ dir: entry.name, pkg });
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}

let failed = false;
const publishable = findPublishablePackages();
if (publishable.length === 0) {
  console.error("[preflight] ERROR: no publishable packages found under packages/");
  process.exit(1);
}
console.log(`[preflight] scanning ${publishable.length} publishable package(s): ${publishable.map((p) => p.dir).join(", ")}`);

for (const { dir, pkg } of publishable) {
  const findings = [];
  const canonical = CANONICAL_PACKAGES[dir];
  if (!canonical) {
    findings.push(`unexpected publishable package directory: ${dir}`);
  } else {
    if (pkg.name !== canonical.name) {
      findings.push(`name must be "${canonical.name}" (found "${pkg.name}")`);
    }
    const bins = Object.keys(pkg.bin ?? {}).sort();
    const expectedBins = [...canonical.bins].sort();
    if (JSON.stringify(bins) !== JSON.stringify(expectedBins)) {
      findings.push(`bins must preserve ${JSON.stringify(expectedBins)} (found ${JSON.stringify(bins)})`);
    }
    if (pkg.publishConfig?.access !== "public") {
      findings.push('publishConfig.access must be "public" for scoped packages');
    }
  }
  for (const field of DEPS_FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (typeof spec === "string" && spec.startsWith("workspace:")) {
        findings.push(`${field}["${name}"] = "${spec}"`);
      }
    }
  }
  if (pkg.bundledDependencies !== undefined || pkg.bundleDependencies !== undefined) {
    findings.push("bundledDependencies field present (forbidden since ADR-119 — triggers npm 11 global-install bug #115)");
  }
  for (const hook of ["prepack", "postpack"]) {
    if (pkg.scripts?.[hook]) findings.push(`scripts.${hook} present (no manifest mutation allowed since ADR-119)`);
  }
  if (findings.length > 0) {
    failed = true;
    console.error(`[preflight] ❌ ${dir}:`);
    for (const f of findings) console.error(`  - ${f}`);
  } else {
    console.log(`[preflight] ✓ ${dir}`);
  }
}

if (publishable.length !== Object.keys(CANONICAL_PACKAGES).length) {
  failed = true;
  console.error(
    `[preflight] ERROR: expected ${Object.keys(CANONICAL_PACKAGES).length} canonical publishable packages, found ${publishable.length}`,
  );
}

for (const relativePath of MCP_REGISTRY_MANIFESTS) {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
  if (typeof manifest.description !== "string" || manifest.description.length > 100) {
    failed = true;
    console.error(
      `[preflight] ERROR: ${relativePath} description must be a string of at most 100 characters (found ${manifest.description?.length ?? "missing"})`,
    );
  }
}

if (failed) {
  console.error("\n[preflight] FAILED — see ADR-052 / ADR-107 / ADR-119 for why each rule exists.");
  process.exit(1);
}
console.log("\n[preflight] ✓ all publishable packages produce clean manifests");
