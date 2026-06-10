# Inline-bundle `@ask-llm/shared` (fix #115) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix #115 (Node 26 `npm install -g` → `ERR_MODULE_NOT_FOUND`) by inlining `@ask-llm/shared` into each publishable package's `dist/` via tsup, deleting `bundledDependencies` + the prepack/postpack lifecycle entirely.

**Architecture:** Five publishable packages (`ask-gemini-mcp` 1.6.10, `ask-codex-mcp` 0.3.10, `ask-ollama-mcp` 0.3.5, `ask-antigravity-mcp` 0.2.1, `ask-llm-mcp` 0.3.15) switch build from `tsc -b` to tsup with `noExternal: ['@ask-llm/shared']`. Shared moves to `devDependencies` (cascade + local resolution); llm-mcp's sibling deps become real semver ranges. No `workspace:` or `bundledDependencies` survives in any published manifest. Spec: `docs/superpowers/specs/2026-06-10-inline-bundle-shared-design.md` (ADR-119).

**Tech Stack:** tsup 8.5.x (esbuild + rollup-plugin-dts), yarn 4 workspaces, changesets, verdaccio (CI only), GitHub Actions.

**Conversion order is load-bearing:** plugin/root tsconfig decoupling FIRST (Task 2), then llm-mcp (Task 3), then providers (Tasks 4–7). Reason: `claude-plugin` and `llm-mcp` build with `tsc -b` and *reference* the provider packages — converting a provider first would break every `tsc -b` that references it (a non-composite project can't be referenced).

**Working branch:** `fix/115-inline-bundle-shared` (already exists, spec committed).

---

### Task 1: Reproduce #115 on Node 26 (premise validation)

Node v26.0.0 is already installed at `~/.nvm/versions/node/v26.0.0`.

- [ ] **Step 1: Reproduce the bug with the currently published package**

```bash
export PATH="$HOME/.nvm/versions/node/v26.0.0/bin:$PATH"
node -v   # expect v26.0.0
npm install -g ask-llm-mcp@0.3.15 --force 2>&1 | tail -3
ask-llm-mcp doctor 2>&1 | head -10
```

Expected: `doctor` crashes with `ERR_MODULE_NOT_FOUND` mentioning an empty placeholder dep (e.g. `zod/index.js`) imported from `@ask-llm/shared/dist/...`. If it does NOT reproduce, STOP and report — the premise needs re-checking before any conversion work.

- [ ] **Step 2: Clean up and record**

```bash
npm uninstall -g ask-llm-mcp
```

Record the exact error text in the task notes (it goes into the PR body as the "before" evidence).

---

### Task 2: Decouple `claude-plugin` + root tsconfig from MCP project references

**Files:**
- Modify: `packages/claude-plugin/tsconfig.json`
- Modify: `packages/claude-plugin/package.json` (build script)
- Modify: `tsconfig.json` (root)

- [ ] **Step 1: Replace plugin tsconfig** — remove `references`, disable `composite`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": false,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/**/__tests__/**"]
}
```

- [ ] **Step 2: Plugin build script** — `tsc -b` requires composite; switch to plain `tsc`:

In `packages/claude-plugin/package.json`: `"build": "tsc -b"` → `"build": "tsc"`.

- [ ] **Step 3: Root tsconfig** — only shared remains a composite project after this plan; referencing non-composite projects is invalid:

```json
{
  "files": [],
  "references": [{ "path": "packages/shared" }]
}
```

- [ ] **Step 4: Verify** — plugin now resolves `@ask-llm/shared` and `ask-*-mcp/executor` types via node_modules `exports` maps (dist must be built):

```bash
yarn build && yarn workspace @ask-llm/plugin run lint && yarn workspace @ask-llm/plugin run test
```

Expected: build green (foreach order unchanged), plugin lint + 385+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin tsconfig.json
git commit -m "build(plugin): decouple from MCP project references (#115 prep)"
```

---

### Task 3: Convert `ask-llm-mcp` to tsup + real semver sibling ranges

**Files:**
- Create: `packages/llm-mcp/tsup.config.ts`
- Modify: `packages/llm-mcp/package.json`
- Modify: `packages/llm-mcp/tsconfig.json`

- [ ] **Step 1: Create `packages/llm-mcp/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: { resolve: ["@ask-llm/shared"] },
  noExternal: ["@ask-llm/shared"],
  external: ["ask-gemini-mcp", "ask-codex-mcp", "ask-ollama-mcp", "ask-antigravity-mcp"],
});
```

Why: `splitting: true` keeps `loadedExecutors`/module state a per-process singleton across the `index`+`cli` entries; `dts.resolve` inlines shared's types so published `.d.ts` is self-contained; the four siblings stay external (their executors load via string-variable dynamic `import()` at runtime — esbuild leaves those verbatim).

- [ ] **Step 2: Modify `packages/llm-mcp/package.json`**

Changed fields (final state):

```json
"types": "dist/index.d.ts",
"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
"scripts": {
  "build": "tsup",
  "start": "node dist/cli.js",
  "dev": "tsup && node dist/cli.js",
  "test": "vitest run",
  "lint": "biome check src/ && tsc --noEmit"
},
"dependencies": {
  "@modelcontextprotocol/sdk": "^1.27.1",
  "ask-antigravity-mcp": "^0.2.1",
  "ask-codex-mcp": "^0.3.10",
  "ask-gemini-mcp": "^1.6.10",
  "ask-ollama-mcp": "^0.3.5",
  "zod": "^4.3.6"
},
"devDependencies": {
  "@ask-llm/shared": "workspace:*",
  "@biomejs/biome": "^2.4.4",
  "@types/node": "^22.19.13",
  "tsup": "^8.5.1",
  "typescript": "^5.0.0",
  "vitest": "^4.0.18"
}
```

DELETE: `prepack`, `postpack` scripts; the whole `bundledDependencies` array; `"@ask-llm/shared"` from `dependencies` (moves to devDeps above). Siblings switch `workspace:*` → the caret ranges shown (yarn still links the workspace copies because the ranges match the local versions; changesets maintains them via `updateInternalDependencies: "patch"`).

- [ ] **Step 3: Replace `packages/llm-mcp/tsconfig.json`** (drop `references`, disable composite):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": false,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/**/__tests__"]
}
```

- [ ] **Step 4: Install + build + verify**

```bash
yarn install   # lockfile picks up dep changes
yarn workspace ask-llm-mcp run build
head -1 packages/llm-mcp/dist/cli.js          # expect: #!/usr/bin/env node
ls packages/llm-mcp/dist/                      # expect index.js, cli.js, *.d.ts, chunk-*.js
grep -l "@ask-llm/shared" packages/llm-mcp/dist/*.d.ts && echo "DTS-FAIL" || echo "DTS-OK"
yarn workspace ask-llm-mcp run test && yarn workspace ask-llm-mcp run lint
```

Expected: shebang preserved, `DTS-OK`, 56+ tests pass, lint clean.

- [ ] **Step 5: Tarball inspection (the npm-path check ADR-106 skipped)**

```bash
mkdir -p /tmp/i115 && rm -rf /tmp/i115/* && cd packages/llm-mcp
npm pack --pack-destination /tmp/i115 && tar -xzf /tmp/i115/ask-llm-mcp-0.3.15.tgz -C /tmp/i115
node -p "const m=require('/tmp/i115/package/package.json'); JSON.stringify({ws:JSON.stringify(m.dependencies).includes('workspace:'), bundled:m.bundledDependencies??null, prepack:m.scripts.prepack??null})"
tar -tzf /tmp/i115/ask-llm-mcp-0.3.15.tgz | grep -c node_modules || echo "no-node_modules-OK"
cd ../..
```

Expected: `{"ws":false,"bundled":null,"prepack":null}` and `no-node_modules-OK`.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-mcp yarn.lock
git commit -m "build(llm-mcp): tsup inline of @ask-llm/shared, semver sibling ranges (#115)"
```

---

### Task 4: Convert `ask-gemini-mcp`

**Files:** Create `packages/gemini-mcp/tsup.config.ts`; Modify `packages/gemini-mcp/package.json`, `packages/gemini-mcp/tsconfig.json`

- [ ] **Step 1: Create `packages/gemini-mcp/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    executor: "src/utils/geminiExecutor.ts",
    register: "src/tools/index.ts",
  },
  format: ["esm"],
  target: "node20",
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: { resolve: ["@ask-llm/shared"] },
  noExternal: ["@ask-llm/shared"],
});
```

- [ ] **Step 2: Modify `packages/gemini-mcp/package.json`** — changed fields (final state):

```json
"types": "dist/index.d.ts",
"exports": {
  ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./executor": { "types": "./dist/executor.d.ts", "default": "./dist/executor.js" },
  "./register": { "types": "./dist/register.d.ts", "default": "./dist/register.js" }
},
"scripts": {
  "build": "tsup",
  "start": "node dist/cli.js",
  "dev": "tsup && node dist/cli.js",
  "test": "vitest run",
  "lint": "biome check src/ && tsc --noEmit"
},
"dependencies": {
  "@modelcontextprotocol/sdk": "^1.27.1",
  "zod": "^4.3.6"
},
"devDependencies": {
  "@ask-llm/shared": "workspace:*",
  "@biomejs/biome": "^2.4.4",
  "@types/node": "^22.19.13",
  "tsup": "^8.5.1",
  "typescript": "^5.0.0",
  "vitest": "^4.0.18"
}
```

DELETE: `prepack`/`postpack` scripts, `bundledDependencies`. Note the `./executor` + `./register` targets move from `dist/utils/...`/`dist/tools/...` to the flat tsup entry outputs — `llm-mcp` and `claude-plugin` consume these subpaths, which is why the `exports` map must change in the same commit as the build.

- [ ] **Step 3: Replace `packages/gemini-mcp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": false,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/**/__tests__"]
}
```

- [ ] **Step 4: Install, build, verify (package + its consumers)**

```bash
yarn install
yarn workspace ask-gemini-mcp run build
head -1 packages/gemini-mcp/dist/cli.js                                  # shebang
grep -l "@ask-llm/shared" packages/gemini-mcp/dist/*.d.ts && echo "DTS-FAIL" || echo "DTS-OK"
yarn workspace ask-gemini-mcp run test && yarn workspace ask-gemini-mcp run lint
yarn workspace ask-llm-mcp run test          # consumer of ./executor
yarn workspace @ask-llm/plugin run build     # consumer of ./executor types
```

Expected: all green.

- [ ] **Step 5: Tarball inspection**

```bash
cd packages/gemini-mcp && npm pack --pack-destination /tmp/i115
tar -xzf /tmp/i115/ask-gemini-mcp-1.6.10.tgz -C /tmp/i115 --one-top-level=gemini
node -p "const m=require('/tmp/i115/gemini/package/package.json'); JSON.stringify({ws:JSON.stringify(m.dependencies).includes('workspace:'), bundled:m.bundledDependencies??null})"
cd ../..
```

Expected: `{"ws":false,"bundled":null}`.

- [ ] **Step 6: Commit**

```bash
git add packages/gemini-mcp yarn.lock
git commit -m "build(gemini-mcp): tsup inline of @ask-llm/shared (#115)"
```

---

### Task 5: Convert `ask-codex-mcp`

Same pattern as Task 4; repeated in full so the task is self-contained.

- [ ] **Step 1: Create `packages/codex-mcp/tsup.config.ts`** — identical to Task 4 Step 1 except `executor: "src/utils/codexExecutor.ts"`.

- [ ] **Step 2: Modify `packages/codex-mcp/package.json`** — apply exactly the Task 4 Step 2 field changes (same `types`/`exports`/`scripts` blocks verbatim; same `dependencies` = sdk+zod only; same `devDependencies` block with `"@ask-llm/shared": "workspace:*"` + `"tsup": "^8.5.1"`; DELETE `prepack`/`postpack`/`bundledDependencies`).

- [ ] **Step 3: Replace `packages/codex-mcp/tsconfig.json`** with the Task 4 Step 3 content verbatim.

- [ ] **Step 4: Verify**

```bash
yarn install && yarn workspace ask-codex-mcp run build
head -1 packages/codex-mcp/dist/cli.js
grep -l "@ask-llm/shared" packages/codex-mcp/dist/*.d.ts && echo "DTS-FAIL" || echo "DTS-OK"
yarn workspace ask-codex-mcp run test && yarn workspace ask-codex-mcp run lint
yarn workspace @ask-llm/plugin run build && yarn workspace @ask-llm/plugin run test
```

- [ ] **Step 5: Tarball inspection** — as Task 4 Step 5 with `ask-codex-mcp-0.3.10.tgz`.

- [ ] **Step 6: Commit** — `git add packages/codex-mcp yarn.lock && git commit -m "build(codex-mcp): tsup inline of @ask-llm/shared (#115)"`

---

### Task 6: Convert `ask-ollama-mcp`

- [ ] **Step 1: Create `packages/ollama-mcp/tsup.config.ts`** — identical to Task 4 Step 1 except `executor: "src/utils/ollamaExecutor.ts"`. (This entry also exports `isProviderAvailable`, which llm-mcp's availability probe dynamic-imports — same module, nothing extra needed.)

- [ ] **Step 2: Modify `packages/ollama-mcp/package.json`** — apply exactly the Task 4 Step 2 field changes; DELETE `prepack`/`postpack`/`bundledDependencies`.

- [ ] **Step 3: Replace `packages/ollama-mcp/tsconfig.json`** with the Task 4 Step 3 content verbatim.

- [ ] **Step 4: Verify**

```bash
yarn install && yarn workspace ask-ollama-mcp run build
head -1 packages/ollama-mcp/dist/cli.js
grep -l "@ask-llm/shared" packages/ollama-mcp/dist/*.d.ts && echo "DTS-FAIL" || echo "DTS-OK"
yarn workspace ask-ollama-mcp run test && yarn workspace ask-ollama-mcp run lint
yarn workspace ask-llm-mcp run test
```

- [ ] **Step 5: Tarball inspection** — as Task 4 Step 5 with `ask-ollama-mcp-0.3.5.tgz`.

- [ ] **Step 6: Commit** — `git add packages/ollama-mcp yarn.lock && git commit -m "build(ollama-mcp): tsup inline of @ask-llm/shared (#115)"`

---

### Task 7: Convert `ask-antigravity-mcp`

- [ ] **Step 1: Create `packages/antigravity-mcp/tsup.config.ts`** — identical to Task 4 Step 1 except `executor: "src/utils/antigravityExecutor.ts"`.

- [ ] **Step 2: Modify `packages/antigravity-mcp/package.json`** — apply exactly the Task 4 Step 2 field changes; DELETE `prepack`/`postpack`/`bundledDependencies`.

- [ ] **Step 3: Replace `packages/antigravity-mcp/tsconfig.json`** with the Task 4 Step 3 content verbatim.

- [ ] **Step 4: Verify**

```bash
yarn install && yarn workspace ask-antigravity-mcp run build
head -1 packages/antigravity-mcp/dist/cli.js
grep -l "@ask-llm/shared" packages/antigravity-mcp/dist/*.d.ts && echo "DTS-FAIL" || echo "DTS-OK"
yarn workspace ask-antigravity-mcp run test && yarn workspace ask-antigravity-mcp run lint
```

- [ ] **Step 5: Tarball inspection** — as Task 4 Step 5 with `ask-antigravity-mcp-0.2.1.tgz`.

- [ ] **Step 6: Full-repo gate before moving to pipeline work**

```bash
yarn build && yarn test && yarn lint
```

Expected: all workspaces green, including docs build.

- [ ] **Step 7: Commit** — `git add packages/antigravity-mcp yarn.lock && git commit -m "build(antigravity-mcp): tsup inline of @ask-llm/shared (#115)"`

---

### Task 8: Changesets cascade experiment (spec §3.5 must-verify)

The published artifacts now *embed* shared, so a shared fix must still trigger MCP republishes. Verify the cascade fires across the new devDependency edge.

- [ ] **Step 1: Run the experiment (scratch, fully reverted)**

```bash
cat > .changeset/zz-cascade-experiment.md <<'EOF'
---
"@ask-llm/shared": patch
---

Cascade experiment — does a shared-only changeset bump the five MCPs across a devDependency edge?
EOF
yarn changeset version
git diff --name-only -- 'packages/*/package.json'
node -p "['gemini-mcp','codex-mcp','ollama-mcp','antigravity-mcp','llm-mcp'].map(p=>p+': '+require('./packages/'+p+'/package.json').version).join('\n')"
git checkout -- . && rm -f .changeset/zz-cascade-experiment.md && git status --short   # expect clean
```

Decision rule: if all five MCP versions bumped → cascade works; record "verified 2026-06-10" in ADR-119's Status line (Task 12) and SKIP Steps 2–3. If they did NOT bump → execute Steps 2–3.

- [ ] **Step 2 (ONLY if cascade failed): Create `scripts/check-shared-changeset.mjs`**

```js
#!/usr/bin/env node
// CI guard (ADR-119 fallback): the five publishable MCPs embed @ask-llm/shared
// at build time (tsup noExternal), so a shared change MUST ship with a changeset
// covering all five — otherwise the fix silently never reaches npm.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REQUIRED = ["ask-gemini-mcp", "ask-codex-mcp", "ask-ollama-mcp", "ask-antigravity-mcp", "ask-llm-mcp"];
const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main";

const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
  .split("\n").filter(Boolean);
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
console.log("[shared-changeset] shared change covered by changesets for all 5 MCPs — OK");
```

- [ ] **Step 3 (ONLY if cascade failed): Wire into `.github/workflows/ci.yml`** — add after the "Run tests" step of the `test` job:

```yaml
    - name: Guard — shared changes must changeset all five MCPs (ADR-119)
      if: github.event_name == 'pull_request'
      run: node scripts/check-shared-changeset.mjs
```

- [ ] **Step 4: Commit (experiment result + guard if created)**

```bash
git add -A && git commit -m "ci: verify shared→MCP cascade across devDep edge (#115)" --allow-empty
```

(`--allow-empty` covers the cascade-works path where only ADR text changes later.)

---

### Task 9: Retire the bundling lifecycle; rewrite the preflight gate

**Files:**
- Delete: `scripts/prepack-bundle.mjs`, `scripts/postpack-restore.mjs`
- Rewrite: `scripts/preflight-no-workspace-protocol.mjs`
- Modify: `.github/workflows/release.yml` (comments only), `.gitignore`

- [ ] **Step 1: Delete the lifecycle scripts**

```bash
git rm scripts/prepack-bundle.mjs scripts/postpack-restore.mjs
grep -rn "prepack-bundle\|postpack-restore" packages/*/package.json && echo "FAIL: stale refs" || echo "OK"
```

- [ ] **Step 2: Rewrite `scripts/preflight-no-workspace-protocol.mjs`** (full replacement — static scan; no lifecycle exists to fire anymore):

```js
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
```

- [ ] **Step 3: Prove the gate catches both regression classes**

```bash
node scripts/preflight-no-workspace-protocol.mjs                       # expect: all ✓, exit 0
node -e "const f='packages/gemini-mcp/package.json',j=require('./'+f);j.bundledDependencies=['@ask-llm/shared'];require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
node scripts/preflight-no-workspace-protocol.mjs; echo "exit=$?"        # expect: ❌ + exit=1
git checkout -- packages/gemini-mcp/package.json
node -e "const f='packages/gemini-mcp/package.json',j=require('./'+f);j.dependencies['@ask-llm/shared']='workspace:*';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
node scripts/preflight-no-workspace-protocol.mjs; echo "exit=$?"        # expect: ❌ + exit=1
git checkout -- packages/gemini-mcp/package.json
```

- [ ] **Step 4: Update `.github/workflows/release.yml` comments** — replace the stale prepack-era comment above the preflight step (lines 42–50) with:

```yaml
      # Preflight gate (ADR-107, rules extended by ADR-119): statically assert no
      # publishable manifest carries `workspace:` deps, bundledDependencies, or
      # prepack/postpack hooks. Since ADR-119 @ask-llm/shared is INLINED into each
      # MCP's dist/ by tsup (no bundling, no pack-time rewrite), so what's in source
      # is exactly what npm publishes. History: ADR-052 (npm 9 EUNSUPPORTEDPROTOCOL),
      # ADR-106/107 (2026-05-27 broken-release incident), #115 (npm 11 global install).
```

Also replace the stale comment block above the changesets step (lines 54–62) with:

```yaml
      # When pending changesets exist on main: opens/updates the Version Packages PR.
      # When this push IS the merged Version Packages PR: runs `yarn changeset:publish`
      # which builds + publishes any packages whose version is ahead of the registry.
      # Since ADR-119 there are NO pack-time lifecycle hooks — tsup inlines
      # @ask-llm/shared at build time and manifests publish as-is.
```

- [ ] **Step 5: Clean `.gitignore`** — delete lines 42–43:

```
# Transient backup from ADR-052 prepack-bundle workflow
packages/*/package.json.bak
```

- [ ] **Step 6: Verify + commit**

```bash
node scripts/preflight-no-workspace-protocol.mjs && yarn build && yarn test
git add -A && git commit -m "build: retire prepack bundling lifecycle, strengthen preflight gate (#115)"
```

---

### Task 10: Node 26 global-install CI smoke

**Files:**
- Create: `.github/verdaccio/config.yaml`
- Modify: `.github/workflows/ci.yml` (new job)

- [ ] **Step 1: Create `.github/verdaccio/config.yaml`**

```yaml
# Throwaway local registry for the Node 26 global-install smoke (ADR-119).
# ask-llm-mcp's freshly-bumped sibling ranges may not exist on npmjs yet at PR
# time, so we publish all five tarballs here and install the orchestrator from it.
storage: ./storage
auth:
  htpasswd:
    file: ./htpasswd
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  '**':
    access: $all
    publish: $all
    proxy: npmjs
log: { type: stdout, format: pretty, level: warn }
```

- [ ] **Step 2: Add the job to `.github/workflows/ci.yml`** (after the `test` job, same indent level):

```yaml
  node26-global-install:
    # #115 regression smoke (ADR-119): npm 11 global install of bundledDependencies
    # produced empty transitive-dep dirs and ERR_MODULE_NOT_FOUND on Node 26.
    # This job proves every publishable tarball global-installs and boots on Node 26.
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
    - uses: actions/checkout@v6
    - uses: actions/setup-node@v6
      with:
        node-version: 26
    - run: corepack enable
    - run: yarn install --immutable
    - run: yarn build
    - name: Pack all publishable tarballs (npm pack — the real publish shape)
      run: |
        mkdir -p /tmp/tarballs
        for p in gemini-mcp codex-mcp ollama-mcp antigravity-mcp llm-mcp; do
          (cd "packages/$p" && npm pack --pack-destination /tmp/tarballs)
        done
        ls -la /tmp/tarballs
    - name: Global-install + boot smoke — provider packages
      run: |
        set -eu
        for bin in ask-gemini-mcp ask-codex-mcp ask-ollama-mcp ask-antigravity-mcp; do
          npm install -g /tmp/tarballs/${bin}-*.tgz
          printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}\n' \
            | timeout 20 "$bin" > /tmp/out.json 2> /tmp/err.txt || true
          if grep -q 'ERR_MODULE_NOT_FOUND' /tmp/err.txt; then echo "FAIL: $bin crashed at import"; cat /tmp/err.txt; exit 1; fi
          grep -q '"serverInfo"' /tmp/out.json || { echo "FAIL: $bin no initialize response"; cat /tmp/err.txt; exit 1; }
          echo "OK: $bin boots on Node 26"
        done
    - name: Global-install + doctor smoke — ask-llm-mcp via local registry
      run: |
        set -eu
        npx verdaccio --config .github/verdaccio/config.yaml --listen 4873 &
        npx wait-on -t 30000 http://localhost:4873
        npm config set //localhost:4873/:_authToken fake
        for t in /tmp/tarballs/*.tgz; do npm publish --registry http://localhost:4873 "$t"; done
        npm install -g ask-llm-mcp --registry http://localhost:4873
        ask-llm-mcp doctor --json > /tmp/doctor.json 2> /tmp/doctor-err.txt || true
        if grep -q 'ERR_MODULE_NOT_FOUND' /tmp/doctor-err.txt; then echo "FAIL: doctor crashed at import"; cat /tmp/doctor-err.txt; exit 1; fi
        grep -q '"status"' /tmp/doctor.json || { echo "FAIL: doctor produced no report"; cat /tmp/doctor-err.txt; cat /tmp/doctor.json; exit 1; }
        echo "OK: ask-llm-mcp global install + doctor on Node 26"
```

Note: `doctor` may exit non-zero when no provider CLIs are installed on the runner — the `|| true` + report-shape assertion deliberately tests *module resolution* (the #115 failure), not provider availability.

- [ ] **Step 3: Commit**

```bash
git add .github && git commit -m "ci: Node 26 global-install smoke for all publishable tarballs (#115)"
```

---

### Task 11: Local Node 26 verification (the fix, on the machine that reproduced the bug)

- [ ] **Step 1: Install the fixed tarballs globally on Node 26**

```bash
export PATH="$HOME/.nvm/versions/node/v26.0.0/bin:$PATH"
node -v   # v26.0.0
yarn build
mkdir -p /tmp/i115-final && rm -f /tmp/i115-final/*.tgz
for p in gemini-mcp codex-mcp ollama-mcp antigravity-mcp llm-mcp; do (cd "packages/$p" && npm pack --pack-destination /tmp/i115-final); done
npm install -g /tmp/i115-final/ask-gemini-mcp-*.tgz /tmp/i115-final/ask-codex-mcp-*.tgz /tmp/i115-final/ask-ollama-mcp-*.tgz /tmp/i115-final/ask-antigravity-mcp-*.tgz
```

- [ ] **Step 2: llm-mcp needs its siblings resolvable — install its tarball with the siblings already global won't satisfy npm's resolver; use a local file install check instead**

```bash
mkdir -p /tmp/i115-proj && cd /tmp/i115-proj && rm -rf node_modules package*.json
npm init -y >/dev/null
npm install /tmp/i115-final/ask-gemini-mcp-*.tgz /tmp/i115-final/ask-codex-mcp-*.tgz /tmp/i115-final/ask-ollama-mcp-*.tgz /tmp/i115-final/ask-antigravity-mcp-*.tgz
npm install /tmp/i115-final/ask-llm-mcp-*.tgz
npx ask-llm-mcp doctor 2>&1 | head -20   # expect a diagnostic report, NO ERR_MODULE_NOT_FOUND
cd /Users/anton_personal/GitHub/ask-llm
```

- [ ] **Step 3: Boot smoke for one provider bin on Node 26**

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}\n' | timeout 20 ask-gemini-mcp > /tmp/out.json 2>/tmp/err.txt || true
grep -q '"serverInfo"' /tmp/out.json && echo "BOOT-OK" || { cat /tmp/err.txt; echo "BOOT-FAIL"; }
```

Expected: `BOOT-OK`. Record before/after evidence for the PR body. Clean up: `npm uninstall -g ask-gemini-mcp ask-codex-mcp ask-ollama-mcp ask-antigravity-mcp`.

(The true `npm install -g ask-llm-mcp` path on Node 26 is covered by the CI verdaccio job and, post-merge, by installing the published version — note this in the PR.)

---

### Task 12: Docs + changeset

**Files:** Modify `docs/CONTRIBUTING.md`, `docs/BUGS.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md` (ADR-119 status), Create `.changeset/inline-bundle-shared.md`

- [ ] **Step 1: Fix `docs/CONTRIBUTING.md`** (currently stale — still describes the reverted ADR-106 world). Replace the sentence at line 82 ending `(\`@ask-llm/shared\` is published as a public npm package since ADR-106 — bundling was removed.)` with:

```
(`@ask-llm/shared` is private and INLINED into each MCP's `dist/` at build time by tsup since ADR-119 — there is no bundling and no publish-time manifest rewriting.)
```

In the line-94 paragraph, replace `via \`yarn npm publish\`. Yarn 4 automatically rewrites \`workspace:*\` references to the actual workspace version at publish time, so all 5 packages (\`@ask-llm/shared\`, \`ask-gemini-mcp\`, \`ask-codex-mcp\`, \`ask-ollama-mcp\`, \`ask-llm-mcp\`) land on npm with valid semver in their manifests.` with:

```
via `npm publish` (changesets/action). Since ADR-119 the manifests publish exactly as they exist in source — no `workspace:` protocol remains (llm-mcp's sibling deps are real semver ranges maintained by changesets; `@ask-llm/shared` is a devDependency, inlined into `dist/` by tsup), so no rewrite step exists to get wrong.
```

- [ ] **Step 2: Update `docs/BUGS.md` #115 entry** — change the Status line of the `### #115` entry under `## Open` to:

```
- **Status:** **FIXED (pending publish)** by ADR-119 (`fix/115-inline-bundle-shared`): tsup inlines `@ask-llm/shared` into each MCP's `dist/`; `bundledDependencies` + prepack/postpack deleted repo-wide, so the npm-11 global-install trigger no longer exists. Verified: #115 reproduced on local Node 26 against `ask-llm-mcp@0.3.15`, then fixed tarballs installed + booted clean on the same binary; permanent Node 26 global-install CI smoke added. Closes the loop on B1-vs-B2 deferred by ADR-107.
```

- [ ] **Step 3: Update ADR-119 Status** in `docs/DECISIONS.md` from `(design phase — spec approved, implementation pending; ...)` to `(implemented on \`fix/115-inline-bundle-shared\`; ...)` and append the Task 8 cascade-experiment result (one sentence: verified-fires OR guard-added).

- [ ] **Step 4: Add ROADMAP entry** — prepend under the existing 2026-06-10 design entry heading, a short "implementation landed" line referencing the PR.

- [ ] **Step 5: Create `.changeset/inline-bundle-shared.md`**

```md
---
"ask-gemini-mcp": patch
"ask-codex-mcp": patch
"ask-ollama-mcp": patch
"ask-antigravity-mcp": patch
"ask-llm-mcp": patch
---

Fix #115: `npm install -g` / `npx -y` on Node 26 crashed with `ERR_MODULE_NOT_FOUND` (npm 11 left empty placeholder dirs for bundled packages' transitive deps). `@ask-llm/shared` is now inlined into each package's `dist/` at build time (tsup); `bundledDependencies` and the prepack/postpack manifest rewriting are gone entirely, so published manifests contain plain semver only.
```

- [ ] **Step 6: Commit**

```bash
git add docs .changeset && git commit -m "docs: ADR-119 implementation notes, BUGS #115 fixed-pending-publish, changeset (#115)"
```

---

### Task 13: Final verification, push, PR

- [ ] **Step 1: Full gate**

```bash
yarn build && yarn lint && yarn test && node scripts/preflight-no-workspace-protocol.mjs
```

Expected: all green across all workspaces (174+ MCP tests, 385+ plugin tests), gate ✓.

- [ ] **Step 2: Push and open PR** (pre-push smoke spawns live gemini/codex — quota failures skip-with-warning per ADR-051):

```bash
git push -u origin fix/115-inline-bundle-shared
gh pr create --title "fix(packaging): inline @ask-llm/shared via tsup — Node 26 global install (#115)" --body "$(cat <<'EOF'
## Summary
- Fixes #115: `npm install -g` / `npx -y` crash on Node 26 (`ERR_MODULE_NOT_FOUND` from npm 11's bundledDependencies global-install bug)
- tsup inlines `@ask-llm/shared` into each publishable package's `dist/` (`noExternal`, dts rollup, `splitting: true`)
- Deletes `bundledDependencies` + prepack/postpack lifecycle (`prepack-bundle.mjs`, `postpack-restore.mjs`) — no publish-time manifest mutation remains
- llm-mcp sibling deps move `workspace:*` → real semver ranges (changesets-maintained); shared becomes a devDependency (cascade verified per ADR-119)
- Preflight gate rewritten: static scan, now also forbids `bundledDependencies` and pack hooks
- New Node 26 CI job: `npm pack` → global install → MCP initialize/doctor boot smoke (verdaccio for the orchestrator)

## Evidence
- Before: #115 reproduced on local Node 26 against `ask-llm-mcp@0.3.15` (error transcript in Task 1 notes)
- After: fixed tarballs install + boot clean on the same Node 26 binary

Design: `docs/superpowers/specs/2026-06-10-inline-bundle-shared-design.md` (ADR-119)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Per repo rules — wait for CI + claude-review, address findings, resolve threads before merge.**

