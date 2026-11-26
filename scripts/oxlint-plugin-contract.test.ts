import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const manifests = [
  "package.json",
  "packages/antigravity-mcp/package.json",
  "packages/claude-mcp/package.json",
  "packages/claude-plugin/package.json",
  "packages/codex-mcp/package.json",
  "packages/gemini-mcp/package.json",
  "packages/grok-mcp/package.json",
  "packages/llm-mcp/package.json",
  "packages/ollama-mcp/package.json",
  "packages/shared/package.json",
];

interface PackageManifest {
  devDependencies?: Record<string, string>;
}

interface OxlintConfig {
  jsPlugins?: { name: string; specifier: string }[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, root), "utf8"));
}

describe("Oxlint plugin contract", () => {
  it("pins Oxlint and its plugin API to the same exact version", () => {
    const pluginVersion = readJson<PackageManifest>("package.json").devDependencies?.["@oxlint/plugins"];
    expect(pluginVersion).toMatch(/^\d+\.\d+\.\d+$/);

    for (const path of manifests) {
      expect(readJson<PackageManifest>(path).devDependencies?.oxlint, path).toBe(pluginVersion);
    }
  });

  it("registers the vendored plugin and includes its license and provenance files", () => {
    const config = readJson<OxlintConfig>(".oxlintrc.json");
    const plugin = config.jsPlugins?.find(({ name }) => name === "anti-slop");
    expect(plugin?.specifier).toBe("./tools/oxlint/anti-slop/index.ts");

    const vendor = new URL("tools/oxlint/anti-slop/", root);
    for (const path of ["index.ts", "LICENSE", "UPSTREAM.md", "vendor/eslint-stylistic/LICENSE"]) {
      expect(existsSync(new URL(path, vendor)), path).toBe(true);
    }
  });
});
