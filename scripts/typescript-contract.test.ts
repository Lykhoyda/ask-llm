import { readFileSync } from "node:fs";
import { version as typescriptVersion } from "typescript";
import { describe, expect, it } from "vitest";
import antigravityConfig from "../packages/antigravity-mcp/tsdown.config.js";
import claudeConfig from "../packages/claude-mcp/tsdown.config.js";
import codexConfig from "../packages/codex-mcp/tsdown.config.js";
import geminiConfig from "../packages/gemini-mcp/tsdown.config.js";
import grokConfig from "../packages/grok-mcp/tsdown.config.js";
import llmConfig from "../packages/llm-mcp/tsdown.config.js";
import ollamaConfig from "../packages/ollama-mcp/tsdown.config.js";

const ROOT = new URL("../", import.meta.url);

const TYPESCRIPT_PACKAGES = [
  ".",
  "packages/antigravity-mcp",
  "packages/claude-mcp",
  "packages/claude-plugin",
  "packages/codex-mcp",
  "packages/gemini-mcp",
  "packages/grok-mcp",
  "packages/llm-mcp",
  "packages/ollama-mcp",
  "packages/shared",
] as const;

const TSDOWN_PACKAGES = TYPESCRIPT_PACKAGES.filter(
  (packagePath) => packagePath !== "." && packagePath !== "packages/claude-plugin" && packagePath !== "packages/shared",
);

const TSDOWN_CONFIGS = [
  antigravityConfig,
  claudeConfig,
  codexConfig,
  geminiConfig,
  grokConfig,
  llmConfig,
  ollamaConfig,
];

interface PackageManifest {
  packageManager?: string;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
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

describe("Node 24 LTS runtime contract", () => {
  it("declares, targets, and types against Node 24 in every workspace", () => {
    for (const packagePath of [...TYPESCRIPT_PACKAGES, "apps/docs"]) {
      const manifest = readJson<PackageManifest>(`${packagePath}/package.json`);
      expect(manifest.engines?.node, packagePath).toBe(">=24.0.0");
    }
    for (const packagePath of TYPESCRIPT_PACKAGES) {
      const manifest = readJson<PackageManifest>(`${packagePath}/package.json`);
      expect(manifest.devDependencies?.["@types/node"], packagePath).toMatch(/^\^24\./);
    }
    for (const [index, config] of TSDOWN_CONFIGS.entries()) {
      expect(config, TSDOWN_PACKAGES[index]).toMatchObject({ target: "node24" });
    }
  });
});
