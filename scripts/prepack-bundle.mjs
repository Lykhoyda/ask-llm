#!/usr/bin/env node
/**
 * Bundles workspace dependencies into node_modules/ AND rewrites
 * `workspace:*` → `*` in all package.json files that will be included
 * in the published tarball. Called from each MCP package's prepack
 * script.
 *
 * WHY THIS EXISTS — see ADR-052 for the full story. Short version:
 *
 * - `npm exec ask-llm-mcp` / `npx -y ask-llm-mcp` fetches the
 *   package MANIFEST (the published package.json) from the registry
 *   FIRST and computes the dep tree from that manifest BEFORE
 *   downloading the tarball.
 * - npm 9 (shipped with Node 18, used by Claude Desktop) doesn't
 *   recognize the `workspace:` URL type when it appears in the
 *   manifest's `dependencies` field, and fails with
 *   `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`.
 * - `bundledDependencies` doesn't help, because the manifest-read
 *   path never gets to the tarball extraction step.
 * - The fix is to rewrite `workspace:*` → `*` in the package.json
 *   BEFORE publish, so the registry manifest contains valid semver.
 *   Then npm 9 can parse the manifest, downloads the tarball, sees
 *   the bundled deps in `node_modules/`, and uses them.
 *
 * Usage (invoked from a package directory via the `prepack` script):
 *   node ../../scripts/prepack-bundle.mjs shared
 *   node ../../scripts/prepack-bundle.mjs shared gemini-mcp codex-mcp ollama-mcp
 *
 * Each positional argument is a workspace package name under
 * `packages/`. For `shared`, the bundled destination is
 * `node_modules/@ask-llm/shared/`. For anything else, it's
 * `node_modules/ask-<name>/` (matching the npm package name).
 *
 * The script:
 *   1. Backs up the top-level package.json → package.json.bak
 *      (postpack-restore.mjs restores it after pack finishes).
 *   2. Copies `packages/<dep>/dist` and `packages/<dep>/package.json`
 *      into the corresponding `node_modules/` subdirectory.
 *   3. Rewrites `workspace:*` → `*` in the top-level package.json
 *      AND in every bundled package.json.
 */
import fs from "node:fs";
import path from "node:path";

const DEPS_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const WORKSPACE_PROTOCOL = "workspace:";

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function rewriteWorkspaceRefs(file) {
  if (!fs.existsSync(file)) return 0;
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  let rewrites = 0;
  for (const field of DEPS_FIELDS) {
    const deps = pkg[field];
    if (!deps || typeof deps !== "object") continue;
    for (const key of Object.keys(deps)) {
      const spec = deps[key];
      if (typeof spec === "string" && spec.startsWith(WORKSPACE_PROTOCOL)) {
        deps[key] = "*";
        rewrites++;
      }
    }
  }
  if (rewrites > 0) {
    fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return rewrites;
}

const depsArg = process.argv.slice(2);
if (depsArg.length === 0) {
  console.error("[prepack-bundle] usage: node scripts/prepack-bundle.mjs <dep> [dep...]");
  process.exit(1);
}

// Working dir when `npm pack`/`npm publish` runs the prepack hook is the
// package directory itself, so the workspace root is two levels up.
const workspaceRoot = path.resolve(process.cwd(), "../..");
console.log(`[prepack-bundle] cwd=${process.cwd()}`);
console.log(`[prepack-bundle] bundling: ${depsArg.join(", ")}`);

// 1. Back up the package.json so postpack-restore can put it back.
if (!fs.existsSync("package.json.bak")) {
  fs.copyFileSync("package.json", "package.json.bak");
  console.log("[prepack-bundle] backed up package.json → package.json.bak");
}

// 2. Copy each workspace dep's dist + package.json into node_modules/.
const rewriteTargets = ["package.json"];
for (const dep of depsArg) {
  const src = path.join(workspaceRoot, "packages", dep);
  if (!fs.existsSync(src)) {
    console.error(`[prepack-bundle] ERROR: workspace package not found: ${src}`);
    process.exit(1);
  }
  const destName = dep === "shared" ? "@ask-llm/shared" : `ask-${dep}`;
  const dest = path.join("node_modules", destName);

  fs.mkdirSync(dest, { recursive: true });

  const distSrc = path.join(src, "dist");
  if (fs.existsSync(distSrc)) {
    copyRecursive(distSrc, path.join(dest, "dist"));
  } else {
    console.error(`[prepack-bundle] ERROR: ${distSrc} missing — did you run 'yarn build' first?`);
    process.exit(1);
  }

  fs.copyFileSync(path.join(src, "package.json"), path.join(dest, "package.json"));
  rewriteTargets.push(path.join(dest, "package.json"));
  console.log(`[prepack-bundle] bundled ${dep} → ${dest}`);
}

// 3. Rewrite workspace:* → * in the top-level package.json and every
//    bundled package.json. This is the actual ADR-052 fix — the copies
//    above are just the existing bundledDependencies mechanism.
let totalRewrites = 0;
for (const target of rewriteTargets) {
  const n = rewriteWorkspaceRefs(target);
  if (n > 0) {
    console.log(`[prepack-bundle] ${target}: rewrote ${n} workspace:* → *`);
    totalRewrites += n;
  }
}
console.log(`[prepack-bundle] done (${totalRewrites} total rewrite(s))`);
