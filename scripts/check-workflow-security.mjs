import { readFileSync, readdirSync } from "node:fs";
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

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Workflow security checks passed (immutable actions + pinned/checksummed mcp-publisher).");
