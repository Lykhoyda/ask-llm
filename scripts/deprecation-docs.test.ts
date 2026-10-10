import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SITE = "https://lykhoyda.github.io/ask-llm/";
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const DEPRECATED = [
  "@ask-llm/antigravity-mcp",
  "@ask-llm/claude-mcp",
  "@ask-llm/codex-mcp",
  "@ask-llm/gemini-mcp",
  "@ask-llm/grok-mcp",
  "@ask-llm/ollama-mcp",
  "@ask-llm/plugin",
];

function section(text: string, start: string, end: RegExp): string {
  const from = text.indexOf(start);
  if (from === -1) throw new Error(`missing section ${start}`);
  const rest = text.slice(from + start.length);
  const stop = rest.search(end);
  return stop === -1 ? rest : rest.slice(0, stop);
}

function deprecateCommands(text: string): Array<{ line: string; pkg: string; message: string }> {
  return [...text.matchAll(/^npm deprecate (\S+) "([^"]+)"$/gm)].map(([line, pkg, message]) => ({
    line,
    pkg,
    message,
  }));
}

const adr = deprecateCommands(
  section(read("docs/DECISIONS.md"), "## ADR-179:", /^## ADR-/m).split("**Deprecation messages and commands")[1] ?? "",
);
const checklist = deprecateCommands(
  section(read("docs/CONTRIBUTING.md"), "### Deprecating the split packages and the plugin bridge", /^##+ /m),
);

function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

// A site URL resolves when the VitePress source page exists and, for an anchor, holds that heading.
function docsPage(url: string): string | undefined {
  if (!url.startsWith(SITE)) return undefined;
  const [path, anchor] = url.slice(SITE.length).split("#");
  const file = join(
    ROOT,
    "apps/docs",
    path === "" || path.endsWith("/") ? `${path}index.md` : path.replace(/\.html$/, ".md"),
  );
  if (!existsSync(file)) return undefined;
  const headings = [...readFileSync(file, "utf8").matchAll(/^#{1,6} (.+)$/gm)].map(([, heading]) => slug(heading));
  return anchor === undefined || headings.includes(anchor) ? file : undefined;
}

describe("1.0 deprecation record", () => {
  it("lists one npm deprecate command for each of the seven packages, identically in the ADR and the checklist", () => {
    expect(adr.map(({ pkg }) => pkg).sort()).toEqual(DEPRECATED);
    expect(checklist.map(({ line }) => line)).toEqual(adr.map(({ line }) => line));
  });

  it("never deprecates the canonical package", () => {
    expect([...adr, ...checklist].map(({ pkg }) => pkg)).not.toContain("@ask-llm/mcp");
  });

  it("points every deprecation message at a docs page that exists", () => {
    for (const { pkg, message } of adr) {
      const [url, ...more] = message.match(/https:\/\/\S+/g) ?? [];
      expect(more, pkg).toEqual([]);
      expect(url && docsPage(url), `${pkg}: ${url}`).toBe(join(ROOT, "apps/docs/reference/migration.md"));
      expect(message, pkg).toContain("ask-llm setup");
    }
  });

  it("keeps the README migration pointer aligned with the deprecation messages", () => {
    const url = adr[0]?.message.match(/https:\/\/\S+/)?.[0];
    const readme = section(read("README.md"), "## Migrating from @ask-llm/*", /^## /m);
    expect(readme).toContain(`](${url})`);
  });
});
