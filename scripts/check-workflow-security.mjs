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
if (!release.includes("node scripts/publish-mcp-registry.mjs")) {
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
if (
  !/- name: Ensure Ask LLM packages are public on npm\n\s+if: steps\.changesets\.outputs\.published == 'true'/.test(
    release,
  )
) {
  errors.push("Registry recovery dispatches must not require npm access mutations");
}
if (
  !release.includes("already public") ||
  !release.includes("cannot change access") ||
  !/E403|403 Forbidden/.test(release) ||
  /npm access set status=public "\$pkg"\n\s+test "\$\(npm access get status/.test(release)
) {
  errors.push(
    "npm public-access step must not fail the release when packages are already public or the token cannot mutate access",
  );
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
const yarnAuthAssignments = [...release.matchAll(/^\s+YARN_NPM_AUTH_TOKEN:\s*(.+)\s*$/gm)].map((match) => match[1]);
const expectedYarnAuth = "$" + "{{ secrets.NODE_AUTH_TOKEN }}";
if (yarnAuthAssignments.length < 2 || yarnAuthAssignments.some((value) => value !== expectedYarnAuth)) {
  errors.push(
    "Yarn Berry publish must receive YARN_NPM_AUTH_TOKEN from secrets.NODE_AUTH_TOKEN on the npm verify and changeset publish steps",
  );
}
if (!release.includes("yarn npm whoami")) {
  errors.push("npm authorization preflight must also prove Yarn Berry can authenticate (`yarn npm whoami`)");
}
if (
  !release.includes("YN0000") ||
  !release.includes("Done in ") ||
  /yarn_user=\$\(yarn npm whoami\)\s*\n\s*if \[ "\$user" != "\$yarn_user" \]/.test(release)
) {
  errors.push("npm authorization preflight must compare Yarn whoami usernames after stripping YN0000 log noise");
}
if (!release.includes("Create or verify per-package Git tags")) {
  errors.push("Normal publication and Registry recovery must create or verify per-package Git tags");
}
if (!release.includes("node scripts/create-or-verify-package-tags.mjs --verify-npm-git-head")) {
  errors.push("Release automation must use the fail-closed per-package tag helper with npm gitHead verification");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Workflow security checks passed (immutable actions + pinned/checksummed mcp-publisher).");
