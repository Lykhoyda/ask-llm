#!/usr/bin/env node
// Release allowlist guard (ADR-202): a release may publish only the canonical npm packages and the
// canonical MCP Registry server. Every retired split package and legacy Registry server stays retired.
//
// Run locally: node scripts/release-allowlist.ts [server.json ...]
// With no arguments it checks the workspace publish set and packages/llm-mcp/server.json.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ALLOWED_NPM_PACKAGES: readonly string[] = ["@ask-llm/mcp", "@ask-llm/plugin"];
export const ALLOWED_REGISTRY_SERVERS: readonly string[] = ["io.github.Lykhoyda/ask-llm"];
export const DEFAULT_REGISTRY_MANIFESTS: readonly string[] = ["packages/llm-mcp/server.json"];

interface WorkspaceManifest {
  name?: string;
  private?: boolean;
}

export interface Workspace {
  dir: string;
  name: string | undefined;
}

interface RegistryManifest {
  name?: unknown;
  packages?: unknown;
}

export function npmPublishViolations(names: readonly (string | undefined)[]): string[] {
  return names
    .filter((name) => name === undefined || !ALLOWED_NPM_PACKAGES.includes(name))
    .map((name) => `npm package ${JSON.stringify(name ?? null)} is not in the release allowlist`);
}

export function registryManifestViolations(manifest: RegistryManifest, label = "server.json"): string[] {
  const violations: string[] = [];
  if (typeof manifest.name !== "string" || !ALLOWED_REGISTRY_SERVERS.includes(manifest.name)) {
    violations.push(
      `${label}: Registry server ${JSON.stringify(manifest.name ?? null)} is not in the release allowlist`,
    );
  }
  const packages = Array.isArray(manifest.packages) ? manifest.packages : [];
  for (const entry of packages as Array<{ registryType?: unknown; identifier?: unknown }>) {
    if (entry?.registryType !== "npm") continue;
    const identifier = typeof entry.identifier === "string" ? entry.identifier : undefined;
    for (const violation of npmPublishViolations([identifier])) violations.push(`${label}: ${violation}`);
  }
  return violations;
}

// What `changeset publish` publishes: every workspace whose manifest is not private.
export function publishableWorkspaces(root: string): Workspace[] {
  const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { workspaces?: unknown };
  const patterns = Array.isArray(rootManifest.workspaces) ? (rootManifest.workspaces as string[]) : [];
  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith("/*") && !/[*?[\]{}]/.test(pattern.slice(0, -2))) {
      const parent = pattern.slice(0, -2);
      for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(`${parent}/${entry.name}`);
      }
    } else if (!/[*?[\]{}!]/.test(pattern)) {
      dirs.push(pattern);
    } else {
      throw new Error(`unsupported workspace pattern ${JSON.stringify(pattern)}; teach scripts/release-allowlist.ts`);
    }
  }
  return dirs
    .filter((dir) => existsSync(join(root, dir, "package.json")))
    .map((dir) => ({
      dir,
      manifest: JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as WorkspaceManifest,
    }))
    .filter(({ manifest }) => manifest.private !== true)
    .map(({ dir, manifest }) => ({ dir, name: manifest.name }))
    .sort((left, right) => left.dir.localeCompare(right.dir));
}

export function registryManifestPathViolations(paths: readonly string[], root = process.cwd()): string[] {
  return paths.flatMap((path) => {
    let manifest: RegistryManifest;
    try {
      manifest = JSON.parse(readFileSync(resolve(root, path), "utf8")) as RegistryManifest;
    } catch (error) {
      return [`${path}: cannot read Registry manifest (${(error as Error).message})`];
    }
    return registryManifestViolations(manifest, path);
  });
}

export function releaseAllowlistViolations(root: string, registryManifestPaths: readonly string[]): string[] {
  return [
    ...publishableWorkspaces(root).flatMap(({ dir, name }) =>
      npmPublishViolations([name]).map((violation) => `${dir}: ${violation}`),
    ),
    ...registryManifestPathViolations(registryManifestPaths, root),
  ];
}

function main(): void {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const args = process.argv.slice(2);
  const manifests = args.length > 0 ? args : DEFAULT_REGISTRY_MANIFESTS;
  const violations = releaseAllowlistViolations(root, manifests);
  if (violations.length > 0) {
    console.error("[release-allowlist] FAILED: this release would publish a name outside the allowlist (ADR-202):");
    for (const violation of violations) console.error(`  - ${violation}`);
    console.error(
      `[release-allowlist] npm allowlist: ${ALLOWED_NPM_PACKAGES.join(", ")}; Registry allowlist: ${ALLOWED_REGISTRY_SERVERS.join(", ")}`,
    );
    process.exit(1);
  }
  const names = publishableWorkspaces(root).map(({ name }) => name);
  console.log(`[release-allowlist] npm publish set: ${names.join(", ")}`);
  console.log(`[release-allowlist] Registry manifests: ${manifests.join(", ")}`);
  console.log("[release-allowlist] OK");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
