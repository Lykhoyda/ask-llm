import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(join(process.cwd(), ".onboarding-guard-test-"));
  for (const path of ["scripts", "apps/docs/public", "apps/docs/.vitepress/dist"]) {
    mkdirSync(join(fixture, path), { recursive: true });
  }
  copyFileSync("scripts/check-docs-onboarding.ts", join(fixture, "scripts/check-docs-onboarding.ts"));
  writeFileSync(join(fixture, "README.md"), "# Ask LLM\n");
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

const legacyInstructions = "/plugin install @ask-llm/plugin @ask-llm/codex-mcp";

it.each([
  ["apps/docs/start/install.md", false],
  ["apps/docs/start/providers/install.md", false],
  ["apps/docs/start/reference/install.md", false],
  ["apps/docs/providers/codex.md", true],
  ["apps/docs/reference/migration.md", true],
  ["apps/docs/.vitepress/dist/start/install.html", false],
  ["apps/docs/.vitepress/dist/start/providers/install.html", false],
  ["apps/docs/.vitepress/dist/start/reference/install.html", false],
  ["apps/docs/.vitepress/dist/providers/codex.html", true],
  ["apps/docs/.vitepress/dist/reference/migration.html", true],
  ["apps/docs/public/llms-full.txt", false],
])("checks legacy instructions in %s with exemption=%s", (path, exempt) => {
  const target = join(fixture, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, legacyInstructions);
  const result = spawnSync(process.execPath, [join(fixture, "scripts/check-docs-onboarding.ts")], {
    encoding: "utf8",
  });
  expect(result.status).toBe(exempt ? 0 : 1);
  if (!exempt) expect(result.stderr).toContain(`${path}:1: legacy onboarding instruction`);
});
