#!/usr/bin/env node
/**
 * Preflight gate (ADR-107): assert that no `workspace:` protocol literal
 * survives into the manifest each MCP package would publish to npm.
 *
 * WHY THIS EXISTS — 2026-05-27 incident: PR #126 removed the
 * `scripts/prepack-bundle.mjs` rewrite step on the (wrong) assumption that
 * yarn 4 would rewrite `workspace:*` → fixed-version at publish time.
 * Yarn 4 only rewrites via `yarn npm publish`. The changesets/action
 * release pipeline invokes `npm publish` directly, which preserves
 * `workspace:*` literally. Four packages shipped with broken manifests
 * (`workspace:*` in `dependencies`), causing `npm install` to fail with
 * `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"` for any
 * downstream user.
 *
 * This gate runs `npm pack --dry-run --json` in each publishable package
 * — which fires the restored `prepack-bundle.mjs` lifecycle — then parses
 * the manifest that would have been published and fails the workflow if
 * any `workspace:` literal is found in dependencies, peerDependencies,
 * or optionalDependencies. The gate runs BEFORE the changesets publish
 * step, so a regression is caught locally and in CI before any tarball
 * reaches the registry.
 *
 * Run locally with: node scripts/preflight-no-workspace-protocol.mjs
 *
 * The script is non-zero on any of:
 *   - `npm pack --dry-run` fails for any package
 *   - any dependency value contains the string `workspace:`
 *   - any expected package directory is missing
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Packages that are actually published to npm. Keep this in sync with the
// publishable workspaces under `packages/`. The plugin and shared packages
// are intentionally excluded — they're either marked `private: true` or
// distributed outside npm.
const PUBLISHABLE_PACKAGES = ["gemini-mcp", "codex-mcp", "ollama-mcp", "llm-mcp"];

const DEPS_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];
const WORKSPACE_PROTOCOL = "workspace:";

function findWorkspaceLiterals(manifest) {
  const findings = [];
  for (const field of DEPS_FIELDS) {
    const deps = manifest[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === "string" && spec.startsWith(WORKSPACE_PROTOCOL)) {
        findings.push({ field, name, spec });
      }
    }
  }
  return findings;
}

function checkPackage(pkgName) {
  const pkgDir = path.join(REPO_ROOT, "packages", pkgName);
  if (!fs.existsSync(pkgDir)) {
    console.error(`[preflight] ERROR: package directory not found: ${pkgDir}`);
    process.exit(1);
  }

  console.log(`[preflight] packing ${pkgName} (dry-run)...`);

  // `npm pack --dry-run --json` runs prepack/postpack lifecycle hooks but does
  // NOT write a tarball. The JSON output contains `files[]` and crucially
  // `name`/`version` from the manifest as npm would publish it. We re-read
  // package.json AFTER `npm pack` runs because the prepack-bundle.mjs script
  // rewrites it in place (the postpack restores it after); we have to capture
  // the rewritten state. Easiest: snapshot package.json content right after
  // prepack runs but before postpack restores it.
  //
  // Strategy: run `npm pack --dry-run --json --pack-destination=<tmp>`, which
  // is enough to fire prepack. Read package.json mid-flight is racy — instead
  // we invoke `prepack` directly, snapshot, then invoke `postpack`. This
  // mirrors the actual publish lifecycle byte-for-byte.

  const pkgJsonPath = path.join(pkgDir, "package.json");
  const originalPkgJson = fs.readFileSync(pkgJsonPath, "utf8");

  // Run prepack directly so we can inspect the rewritten manifest.
  // We catch errors so postpack always runs (cleanup must happen).
  let manifestFindings = [];
  let prepackError = null;
  try {
    execFileSync("npm", ["run", "--silent", "prepack", "--if-present"], {
      cwd: pkgDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const rewrittenPkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    manifestFindings = findWorkspaceLiterals(rewrittenPkg);

    // Also scan any bundled nested package.json files — those go into the
    // tarball too and were the OTHER manifest surface that broke in the
    // 2026-05-27 incident (the bundled `@ask-llm/shared/package.json` etc.).
    const bundled = rewrittenPkg.bundledDependencies || [];
    for (const dep of bundled) {
      const nestedPath = path.join(pkgDir, "node_modules", dep, "package.json");
      if (!fs.existsSync(nestedPath)) continue;
      const nested = JSON.parse(fs.readFileSync(nestedPath, "utf8"));
      const nestedFindings = findWorkspaceLiterals(nested).map((f) => ({
        ...f,
        nested: dep,
      }));
      manifestFindings.push(...nestedFindings);
    }
  } catch (err) {
    prepackError = err;
  } finally {
    // Always run postpack — never leave the working tree mutated.
    try {
      execFileSync("npm", ["run", "--silent", "postpack", "--if-present"], {
        cwd: pkgDir,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (postpackErr) {
      console.error(`[preflight] WARNING: postpack failed for ${pkgName}:`, postpackErr.message);
      // Fall back: restore from our snapshot so the working tree isn't left
      // with a rewritten manifest.
      fs.writeFileSync(pkgJsonPath, originalPkgJson);
    }
  }

  if (prepackError) {
    console.error(`[preflight] ERROR: prepack failed for ${pkgName}`);
    console.error(prepackError.stdout?.toString() || "");
    console.error(prepackError.stderr?.toString() || "");
    process.exit(1);
  }

  if (manifestFindings.length > 0) {
    console.error(`[preflight] ❌ ${pkgName}: ${manifestFindings.length} workspace:* literal(s) survived prepack:`);
    for (const f of manifestFindings) {
      const where = f.nested ? `bundled[${f.nested}].${f.field}` : f.field;
      console.error(`  - ${where}["${f.name}"] = "${f.spec}"`);
    }
    return false;
  }

  console.log(`[preflight] ✓ ${pkgName}: no workspace:* literals in published manifest`);
  return true;
}

let allPassed = true;
for (const pkg of PUBLISHABLE_PACKAGES) {
  if (!checkPackage(pkg)) {
    allPassed = false;
  }
}

if (!allPassed) {
  console.error("");
  console.error("[preflight] FAILED — at least one package would publish with a workspace:* literal.");
  console.error("[preflight] See ADR-052 / ADR-107 for the bundling lifecycle. Most likely cause:");
  console.error("[preflight]   - prepack script in the failing package's package.json was removed");
  console.error("[preflight]   - or scripts/prepack-bundle.mjs was modified/deleted");
  console.error("[preflight]   - or bundledDependencies field was removed from package.json");
  process.exit(1);
}

console.log("");
console.log("[preflight] ✓ all publishable packages produce clean manifests");
