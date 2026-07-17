import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(root, "packages");
const publishedPackages = readdirSync(packagesDir)
  .map((dir) => {
    try {
      return JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8"));
    } catch {
      return null;
    }
  })
  .filter((manifest) => manifest && manifest.private !== true)
  .map((manifest) => manifest.name)
  .sort();

const requiredPackageSurfaces = [
  "README.md",
  "docs/SECURITY.md",
  "apps/docs/public/llms.txt",
  "apps/docs/public/llms-full.txt",
];
const errors = [];

for (const relative of requiredPackageSurfaces) {
  const source = readFileSync(join(root, relative), "utf8");
  for (const packageName of publishedPackages) {
    if (!source.includes(packageName)) errors.push(`${relative} is missing published package ${packageName}`);
  }
}

const providersSource = readFileSync(join(root, "packages/shared/src/providers.ts"), "utf8");
const tuple = providersSource.match(/PROVIDERS\s*=\s*\[([^\]]+)\]/s)?.[1] ?? "";
const providers = [...tuple.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
for (const provider of providers) {
  try {
    readFileSync(join(root, `apps/docs/providers/${provider}.md`), "utf8");
  } catch {
    errors.push(`apps/docs/providers/${provider}.md is missing for canonical provider ${provider}`);
  }
}

// providers.ts must quote the same default/fallback models as package constants.
const dataSource = readFileSync(
  join(root, "apps/docs/.vitepress/theme/providers.ts"),
  "utf8",
);
const modelChecks = [
  ["codex", "packages/codex-mcp/src/constants.ts", /FACTORY_DEFAULT_MODEL = "([^"]+)"/],
  ["claude", "packages/claude-mcp/src/constants.ts", /FACTORY_DEFAULT_MODEL = "([^"]+)"/],
  ["gemini", "packages/gemini-mcp/src/constants.ts", /FACTORY_DEFAULT_MODEL = "([^"]+)"/],
  ["ollama", "packages/ollama-mcp/src/constants.ts", /FACTORY_DEFAULT_MODEL = "([^"]+)"/],
  ["antigravity", "packages/antigravity-mcp/src/constants.ts", /DEFAULT: "([^"]+)"/],
];
for (const [provider, constantsPath, pattern] of modelChecks) {
  const constant = readFileSync(join(root, constantsPath), "utf8").match(pattern)?.[1];
  if (!constant) {
    errors.push(`${constantsPath} no longer matches the default-model pattern for ${provider}`);
    continue;
  }
  if (!dataSource.includes(`defaultModel: "${constant}"`)) {
    errors.push(
      `providers.ts defaultModel for ${provider} is out of sync with ${constantsPath} (expected "${constant}")`,
    );
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Documentation drift checks passed (${publishedPackages.length} packages, ${providers.length} providers).`);
