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
 * HOW THIS WORKS — for each publishable workspace package, the gate
 * invokes `npm run prepack --if-present` (which fires the restored
 * `prepack-bundle.mjs` lifecycle in MCP packages), snapshots the
 * rewritten `package.json` mid-flight, scans for `workspace:` literals
 * in dependencies / peerDependencies / optionalDependencies + nested
 * bundled-package manifests, then runs `npm run postpack --if-present`
 * to clean up. Exits 1 if any literal survived. The gate runs BEFORE the
 * changesets publish step, so a regression is caught locally and in CI
 * before any tarball reaches the registry.
 *
 * We intentionally invoke `npm run prepack` directly rather than
 * `npm pack --dry-run`. Both fire the same lifecycle hooks, but the
 * direct approach lets us snapshot the rewritten manifest between
 * prepack and postpack without parsing tarballs.
 *
 * Run locally with: node scripts/preflight-no-workspace-protocol.mjs
 *
 * The script is non-zero on any of:
 *   - `npm run prepack` fails for any package
 *   - any dependency value contains the string `workspace:`
 *   - any expected package directory is missing
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const DEPS_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];
const WORKSPACE_PROTOCOL = "workspace:";

/**
 * Derive publishable packages dynamically from the workspace config.
 * Walks `packages/*` and includes any package whose package.json does NOT
 * have `"private": true`. This means a future fifth MCP package gets
 * scanned automatically — no manual list to update.
 *
 * Returns array of package directory names under `packages/`.
 */
function findPublishablePackages() {
  const packagesDir = path.join(REPO_ROOT, "packages");
  if (!fs.existsSync(packagesDir)) {
    console.error(`[preflight] ERROR: packages directory not found: ${packagesDir}`);
    process.exit(1);
  }

  const publishable = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(packagesDir, entry.name, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (pkg.private === true) continue;
    publishable.push(entry.name);
  }
  return publishable.sort();
}

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

/**
 * Forcibly clean up bundled node_modules/<dep> directories that
 * prepack-bundle.mjs creates. Called when postpack throws — the normal
 * postpack-restore.mjs would have done this, but if it failed we need
 * to do it manually so the next preflight run starts from a clean state.
 */
function cleanupBundledDirs(pkgDir, bundledDeps) {
  for (const dep of bundledDeps) {
    const bundledPath = path.join(pkgDir, "node_modules", dep);
    if (fs.existsSync(bundledPath) && fs.lstatSync(bundledPath).isDirectory()) {
      fs.rmSync(bundledPath, { recursive: true, force: true });
    }
  }
  // Also clean up the package.json.bak left by prepack if postpack didn't.
  const bakPath = path.join(pkgDir, "package.json.bak");
  if (fs.existsSync(bakPath)) {
    fs.unlinkSync(bakPath);
  }
}

function checkPackage(pkgName) {
  const pkgDir = path.join(REPO_ROOT, "packages", pkgName);
  if (!fs.existsSync(pkgDir)) {
    console.error(`[preflight] ERROR: package directory not found: ${pkgDir}`);
    process.exit(1);
  }

  console.log(`[preflight] checking ${pkgName}...`);

  const pkgJsonPath = path.join(pkgDir, "package.json");
  const originalPkgJson = fs.readFileSync(pkgJsonPath, "utf8");
  const originalPkg = JSON.parse(originalPkgJson);

  // Capture the bundledDependencies list from the ORIGINAL manifest before
  // prepack runs — we need it for cleanup whether prepack succeeds or fails.
  const bundledDeps = originalPkg.bundledDependencies || [];

  let manifestFindings = [];
  let prepackError = null;
  let postpackError = null;

  try {
    execFileSync("npm", ["run", "--silent", "prepack", "--if-present"], {
      cwd: pkgDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const rewrittenPkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    manifestFindings = findWorkspaceLiterals(rewrittenPkg);

    // Also scan nested manifests under bundled dependencies — those go into
    // the published tarball too and were the OTHER manifest surface that
    // broke in the 2026-05-27 incident (the bundled `@ask-llm/shared/package.json`,
    // `ask-gemini-mcp/package.json`, etc., which each also list workspace deps).
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
    } catch (err) {
      postpackError = err;
    }
  }

  // Postpack-failure fallback: restore the original package.json AND clean up
  // any bundled node_modules dirs that prepack created. Skipping the cleanup
  // would leave the working tree with physical copies of bundled deps that
  // break the next preflight run (the prepack backup guard would skip
  // re-backing-up because `package.json.bak` already exists).
  if (postpackError) {
    console.error(`[preflight] WARNING: postpack failed for ${pkgName}: ${postpackError.message}`);
    fs.writeFileSync(pkgJsonPath, originalPkgJson);
    cleanupBundledDirs(pkgDir, bundledDeps);
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

const publishable = findPublishablePackages();
if (publishable.length === 0) {
  console.error("[preflight] ERROR: no publishable packages found under packages/");
  console.error("[preflight] expected at least one package with `private: false` (or no private field)");
  process.exit(1);
}

console.log(`[preflight] scanning ${publishable.length} publishable package(s): ${publishable.join(", ")}`);
console.log("");

let allPassed = true;
for (const pkg of publishable) {
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
