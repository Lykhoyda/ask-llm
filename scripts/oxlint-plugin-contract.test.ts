import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
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

const violations = {
  "no-reduce-accumulator-copy": "export const flat = [[1], [2]].reduce((acc, x) => acc.concat(x), []);\n",
  "no-reflect-apply": "export const max = Reflect.apply(Math.max, undefined, [1, 2]);\n",
  "no-reflect-get": 'export const value = Reflect.get({ k: 1 }, "k");\n',
  "no-widen-then-assert": "const widened: unknown = { a: 1 };\nexport const narrowed = widened as { a: number };\n",
};

interface PackageManifest {
  devDependencies?: Record<string, string>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, root), "utf8"));
}

function oxlint(files: string[]) {
  return spawnSync(join(rootPath, "node_modules/.bin/oxlint"), ["-c", ".oxlintrc.json", ...files], {
    cwd: rootPath,
    encoding: "utf8",
  });
}

describe("Oxlint plugin contract", () => {
  it("pins Oxlint and its plugin API to the same exact version", () => {
    const pluginVersion = readJson<PackageManifest>("package.json").devDependencies?.["@oxlint/plugins"];
    expect(pluginVersion).toMatch(/^\d+\.\d+\.\d+$/);

    for (const path of manifests) {
      expect(readJson<PackageManifest>(path).devDependencies?.oxlint, path).toBe(pluginVersion);
    }
  });

  it("ships the vendored plugin with its provenance files", () => {
    const vendor = new URL("tools/oxlint/anti-slop/", root);
    for (const path of ["index.ts", "LICENSE", "UPSTREAM.md", "vendor/eslint-stylistic/LICENSE"]) {
      expect(existsSync(new URL(path, vendor)), path).toBe(true);
    }
  });

  it("rejects each enabled anti-slop violation and accepts clean code under the root config", () => {
    const fixture = mkdtempSync(join(rootPath, "scripts", "oxlint-contract-"));
    try {
      const violationFiles = Object.entries(violations).map(([rule, source]) => {
        const file = join(fixture, `${rule}.ts`);
        writeFileSync(file, source);
        return file;
      });
      const clean = join(fixture, "clean.ts");
      writeFileSync(
        clean,
        "export const total = [1, 2].reduce((acc, x) => acc + x, 0);\nexport const value = { k: 1 }.k;\n",
      );

      const rejected = oxlint(violationFiles);
      expect(rejected.status, rejected.stderr).not.toBe(0);
      for (const rule of Object.keys(violations)) {
        expect(rejected.stdout, rule).toContain(`anti-slop(${rule})`);
      }

      const accepted = oxlint([clean]);
      expect(accepted.status, `${accepted.stdout}${accepted.stderr}`).toBe(0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
