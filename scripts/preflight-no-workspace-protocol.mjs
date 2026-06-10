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

if (failed) {
  console.error("\n[preflight] FAILED — see ADR-052 / ADR-107 / ADR-119 for why each rule exists.");
  process.exit(1);
}
console.log("\n[preflight] ✓ all publishable packages produce clean manifests");
