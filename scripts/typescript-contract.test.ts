import { readFileSync } from "node:fs";
import { version as typescriptVersion } from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../", import.meta.url);

const TYPESCRIPT_PACKAGES = [
  ".",
  "packages/antigravity-mcp",
  "packages/claude-mcp",
  "packages/claude-plugin",
  "packages/codex-mcp",
  "packages/gemini-mcp",
  "packages/llm-mcp",
  "packages/ollama-mcp",
  "packages/shared",
] as const;

const TSDOWN_PACKAGES = TYPESCRIPT_PACKAGES.filter(
  (packagePath) => packagePath !== "." && packagePath !== "packages/claude-plugin" && packagePath !== "packages/shared",
);

interface PackageManifest {
  packageManager?: string;
  devDependencies?: Record<string, string>;
}

interface TsConfig {
  compilerOptions?: {
    types?: string[];
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, ROOT), "utf8")) as T;
}

function toVersionParts(value: string): [number, number, number] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) {
    throw new Error(`Unparseable version: ${value}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeast(value: string, minimum: string): boolean {
  const actual = toVersionParts(value);
  const floor = toVersionParts(minimum);
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== floor[index]) {
      return actual[index] > floor[index];
    }
  }
  return true;
}

describe("TypeScript 7 toolchain contract", () => {
  it("pins every compiler-owned workspace to TypeScript 7", () => {
    expect(typescriptVersion).toMatch(/^7\./);
    expect(isAtLeast(typescriptVersion, "7.0.2"), typescriptVersion).toBe(true);

    for (const packagePath of TYPESCRIPT_PACKAGES) {
      const manifest = readJson<PackageManifest>(`${packagePath}/package.json`);
      const range = manifest.devDependencies?.typescript;
      expect(range, packagePath).toMatch(/^\^7\./);
      expect(isAtLeast(range ?? "", "7.0.2"), packagePath).toBe(true);
    }
  });

  it("uses TypeScript-7-compatible package and declaration build tooling", () => {
    const rootManifest = readJson<PackageManifest>("package.json");
    expect(rootManifest.packageManager).toMatch(/^yarn@4\./);
    expect(isAtLeast(rootManifest.packageManager ?? "", "4.18.0"), rootManifest.packageManager).toBe(true);

    for (const packagePath of TSDOWN_PACKAGES) {
      const manifest = readJson<PackageManifest>(`${packagePath}/package.json`);
      const range = manifest.devDependencies?.tsdown;
      expect(range, packagePath).toMatch(/^\^0\.22\./);
      expect(isAtLeast(range ?? "", "0.22.14"), packagePath).toBe(true);
    }
  });

  it("loads Node declarations explicitly in shared compiler configurations", () => {
    const baseConfig = readJson<TsConfig>("tsconfig.base.json");
    const scriptsConfig = readJson<TsConfig>("scripts/tsconfig.json");

    expect(baseConfig.compilerOptions?.types).toContain("node");
    expect(scriptsConfig.compilerOptions?.types).toContain("node");
  });
});
