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

describe("TypeScript 7 toolchain contract", () => {
  it("pins every compiler-owned workspace to TypeScript 7", () => {
    expect(typescriptVersion).toBe("7.0.2");

    for (const packagePath of TYPESCRIPT_PACKAGES) {
      const manifest = readJson<PackageManifest>(`${packagePath}/package.json`);
      expect(manifest.devDependencies?.typescript, packagePath).toBe("^7.0.2");
    }
  });

  it("uses TypeScript-7-compatible package and declaration build tooling", () => {
    const rootManifest = readJson<PackageManifest>("package.json");
    expect(rootManifest.packageManager).toBe("yarn@4.18.0");

    for (const packagePath of TSDOWN_PACKAGES) {
      const manifest = readJson<PackageManifest>(`${packagePath}/package.json`);
      expect(manifest.devDependencies?.tsdown, packagePath).toBe("^0.22.14");
    }
  });

  it("loads Node declarations explicitly in shared compiler configurations", () => {
    const baseConfig = readJson<TsConfig>("tsconfig.base.json");
    const scriptsConfig = readJson<TsConfig>("scripts/tsconfig.json");

    expect(baseConfig.compilerOptions?.types).toContain("node");
    expect(scriptsConfig.compilerOptions?.types).toContain("node");
  });
});
