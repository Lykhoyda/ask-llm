import { spawnSync } from "node:child_process";
import { copyFileSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(join(process.cwd(), ".llms-test-"));
  for (const path of ["scripts", "apps/docs/public"]) mkdirSync(join(fixture, path), { recursive: true });
  copyFileSync("scripts/generate-llms.ts", join(fixture, "scripts/generate-llms.ts"));
  for (const path of globSync("**/*.md", { cwd: "apps/docs", exclude: ["node_modules/**", ".vitepress/**"] })) {
    const target = join(fixture, "apps/docs", path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join("apps/docs", path), target);
  }
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

// llms-full.txt is the generated public text contract, not implementation source.
it.each([
  ["<scr<script>hidden</script>ipt>", "<scr\nipt>"],
  ["<!-<!-- hidden -->->", "<!-\n->"],
  ["<scr<!-- hidden -->ipt>", "<scr\nipt>"],
  ["<scr<ProviderChips />ipt>", "<scr\nipt>"],
  ["<scr</TroubleshootingModal>ipt>", "<scr\nipt>"],
  ["before<SCRIPT>hidden</SCRIPT>after", "before\nafter"],
  ["before<ScRiPt setup>hidden</sCrIpT>after", "before\nafter"],
  ["before<script>hidden</script >after", "before\nafter"],
  ["before<script setup>hidden</script\t\r\n>after", "before\nafter"],
  ["before<SCRIPT>hidden</ScRiPt/>after", "before\nafter"],
  ['before<script>hidden</script ignored="value">after', "before\nafter"],
  ["before<script>hidden</scripture>still hidden</script>after", "before\nafter"],
  [
    '<TroubleshootingModal title="Missing CLI" preview="Install the provider">\nRun setup.\n</TroubleshootingModal>',
    "### Missing CLI\n\nInstall the provider\nRun setup.",
  ],
  [
    "<SetupTabs />\n[Review](/start/first-review)",
    "See the install command above; select your host, inspect the preview, and confirm.\n[Review](https://lykhoyda.github.io/ask-llm/start/first-review)",
  ],
])("generates readable text for %s", (input, expected) => {
  writeFileSync(join(fixture, "apps/docs/start/install.md"), `# Fixture\n\n${input}\n`);
  const result = spawnSync(process.execPath, [join(fixture, "scripts/generate-llms.ts")], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  const output = readFileSync(join(fixture, "apps/docs/public/llms-full.txt"), "utf8");
  const page = output
    .split("Source: https://lykhoyda.github.io/ask-llm/start/install.html\n\n")[1]
    ?.split("\n\n### First review")[0];
  expect(page).toBe(expected);
});
