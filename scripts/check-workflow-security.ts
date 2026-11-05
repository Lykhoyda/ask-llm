import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = join(root, ".github", "workflows");
const errors = [];

for (const name of readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file))) {
  const relative = `.github/workflows/${name}`;
  const source = readFileSync(join(workflowsDir, name), "utf8");
  for (const [index, line] of source.split("\n").entries()) {
    const match = line.match(/\buses:\s*([^\s#]+)/);
    if (!match || match[1].startsWith("./")) continue;
    const at = match[1].lastIndexOf("@");
    const ref = at === -1 ? "" : match[1].slice(at + 1);
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      errors.push(`${relative}:${index + 1} action is not pinned to a 40-character commit SHA: ${match[1]}`);
    }
  }
}

const release = readFileSync(join(workflowsDir, "release.yml"), "utf8");
if (release.includes("/releases/latest/")) {
  errors.push(".github/workflows/release.yml must not download mcp-publisher from a mutable latest URL");
}
if (!/MCP_PUBLISHER_VERSION:\s*v\d+\.\d+\.\d+/.test(release)) {
  errors.push(".github/workflows/release.yml must pin MCP_PUBLISHER_VERSION");
}
if (!/MCP_PUBLISHER_SHA256:\s*[0-9a-f]{64}/.test(release) || !release.includes("sha256sum --check --strict")) {
  errors.push(".github/workflows/release.yml must verify the pinned mcp-publisher SHA-256");
}
if (release.includes("continue-on-error: true")) {
  errors.push(".github/workflows/release.yml must fail loudly when a registry publication step fails");
}
if (!release.includes("node scripts/publish-mcp-registry.ts")) {
  errors.push(".github/workflows/release.yml must use the selective MCP Registry publication helper");
}
if (/run:\s*\.\/mcp-publisher (?:login|publish)/.test(release)) {
  errors.push(".github/workflows/release.yml must not bypass the selective helper's OIDC login/publication plan");
}
if (/retry_registry_publish|deprecate_legacy_packages|^\s+inputs:/m.test(release)) {
  errors.push("Release workflow_dispatch must have no inputs; recovery is the only dispatch behavior");
}
if (!release.includes("github.event_name != 'workflow_dispatch'")) {
  errors.push("Registry recovery dispatches must skip changesets/npm publication");
}
if (
  !release.includes(
    "steps.changesets.outputs.published == 'true' || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')",
  )
) {
  errors.push("Manual dispatch on main must repair MCP Registry, unified release, and package tags");
}
if (/Deprecate legacy|npm deprecate/.test(release)) {
  errors.push("Release workflow must not keep a deprecated/legacy-package path");
}
if (!release.includes("Create or verify unified GitHub Release")) {
  errors.push("Registry recovery must create or verify the unified GitHub release");
}
if (!/^\s+create-github-releases:\s*false\b/m.test(release) || /^\s+create-github-releases:\s*true\b/m.test(release)) {
  errors.push("Release automation must keep per-package GitHub Release pages disabled");
}
if (!/^\s+push-git-tags:\s*false\b/m.test(release) || /^\s+push-git-tags:\s*true\b/m.test(release)) {
  errors.push("changesets/action must leave per-package Git tags exclusively to the ADR-151 helper");
}
if (/NODE_AUTH_TOKEN|YARN_NPM_AUTH_TOKEN|NPM_TOKEN|npm (?:whoami|org ls|access)/.test(release)) {
  errors.push("Release automation must use npm trusted publishing without long-lived tokens or token-only checks");
}
if (!/^\s+id-token:\s*write\b/m.test(release)) {
  errors.push("Release automation must grant id-token: write for npm and MCP Registry OIDC");
}
if (!/^\s+YARN_NPM_PUBLISH_PROVENANCE:\s*"true"\s*$/m.test(release)) {
  errors.push("Yarn npm publication must generate provenance");
}
if (!/^\s+YARN_NPM_PUBLISH_REGISTRY:\s*https:\/\/registry\.npmjs\.org\s*$/m.test(release)) {
  errors.push("Yarn npm publication must use the npm registry for trusted publishing");
}
if (!release.includes("Create or verify per-package Git tags")) {
  errors.push("Normal publication and Registry recovery must create or verify per-package Git tags");
}
if (!release.includes("node scripts/create-or-verify-package-tags.ts --verify-npm-git-head")) {
  errors.push("Release automation must use the fail-closed per-package tag helper with npm gitHead verification");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Workflow security checks passed (immutable actions + pinned/checksummed mcp-publisher).");
