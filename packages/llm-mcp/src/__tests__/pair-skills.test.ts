import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_ROOT, parseMarkdownFrontmatter, readFile, readJson } from "./_helpers.js";

const PAIR_SKILLS = ["ask-llm-codex-pair", "ask-llm-grok-pair"] as const;

interface Heading {
  level: number;
  text: string;
  offset: number;
}

function headings(markdown: string): Heading[] {
  const out: Heading[] = [];
  let offset = 0;
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const match = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) out.push({ level: match[1].length, text: match[2], offset });
    offset += line.length + 1;
  }
  return out;
}

function adapterBody(body: string, name: string): string {
  const all = headings(body);
  const start = all.find((heading) => heading.level === 3 && heading.text === `${name} adapter`);
  if (!start) throw new Error(`Missing ${name} adapter`);
  const end = all.find((heading) => heading.offset > start.offset && heading.level <= start.level);
  return body.slice(start.offset, end?.offset ?? body.length);
}

function jsonCodeBlocks(markdown: string): unknown[] {
  return [...markdown.matchAll(/^[ \t]*```json\s*\n([\s\S]*?)\n[ \t]*```/gm)].map((match) => JSON.parse(match[1]));
}

function parsePairSkill(name: string) {
  const raw = readFile(`skills/${name}/SKILL.md`);
  const { frontmatter, body } = parseMarkdownFrontmatter(raw);
  return { frontmatter, body };
}

describe("pair skill structure", () => {
  for (const name of PAIR_SKILLS) {
    describe(name, () => {
      const skill = parsePairSkill(name);

      it("keeps Claude natural-language discovery available alongside the explicit slash command", () => {
        expect(skill.frontmatter.name).toBe(name);
        expect(typeof skill.frontmatter.description).toBe("string");
        expect((skill.frontmatter.description as string).length).toBeGreaterThan(0);
        expect(skill.frontmatter).not.toHaveProperty("disable-model-invocation");
      });
    });
  }

  it("leaves Pi skill discovery to the shared skills folder", () => {
    expect(readJson<{ pi: Record<string, unknown> }>("package.json").pi).not.toHaveProperty("skills");
  });

  it.each(PAIR_SKILLS)("%s publishes a valid Cursor-native unified MCP setup", (name) => {
    const cursor = adapterBody(parsePairSkill(name).body, "Cursor Agent");
    const setup = jsonCodeBlocks(cursor).find(
      (block): block is { mcpServers: Record<string, { command: string; args: string[] }> } =>
        !Array.isArray(block) && typeof block === "object" && block !== null && "mcpServers" in block,
    );
    expect(setup).toEqual({
      mcpServers: { "ask-llm": { command: "npx", args: ["-y", "@ask-llm/mcp"] } },
    });
  });

  it("codex-pair publishes fully pinned first-call protocol shapes for Cursor", () => {
    const cursor = adapterBody(parsePairSkill("ask-llm-codex-pair").body, "Cursor Agent");
    const calls = jsonCodeBlocks(cursor).find(Array.isArray) as
      | Array<{ tool: string; arguments: Record<string, unknown> }>
      | undefined;
    expect(calls?.map((call) => call.tool)).toEqual(["ask-codex", "ask-llm"]);
    for (const call of calls ?? []) {
      expect(Object.keys(call.arguments).sort()).toEqual(
        [
          ...(call.tool === "ask-llm" ? ["provider"] : []),
          "includeDirs",
          "model",
          "prompt",
          "reasoningEffort",
          "sandbox",
          "sessionId",
        ].sort(),
      );
      expect(call.arguments.model).toBe("<required exact ID>");
      expect(call.arguments.reasoningEffort).toBe("<required effort>");
      expect(call.arguments.sandbox).toBe("read-only");
      expect(call.arguments.sessionId).toBe("");
    }
  });
});

describe("shared pairing contract", () => {
  const contract = readFile("skills/ask-llm-codex-pair/pairing-contract.md");

  it("is a plain shared document, not a discoverable skill", () => {
    expect(parseMarkdownFrontmatter(contract).frontmatter).toEqual({});
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "skills", "pairing-contract", "SKILL.md"))).toBe(false);
  });
});
