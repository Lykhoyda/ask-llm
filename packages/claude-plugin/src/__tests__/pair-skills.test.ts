import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_ROOT, parseMarkdownFrontmatter, readFile, readJson } from "./_helpers.js";

const PORTABLE_START = "<!-- PORTABLE-CONTRACT:START -->";
const PORTABLE_END = "<!-- PORTABLE-CONTRACT:END -->";
const CLAUDE_START = "<!-- HOST-ADAPTER:CLAUDE-CODE:START -->";
const CLAUDE_END = "<!-- HOST-ADAPTER:CLAUDE-CODE:END -->";
const PAIR_SKILLS = ["codex-pair", "grok-pair"] as const;

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

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return found;
    found.push(idx);
    from = idx + needle.length;
  }
}

function adapterHeadings(body: string): Heading[] {
  const all = headings(body);
  const host = all.find((h) => h.level === 2 && h.text === "Host adapters");
  if (!host) return [];
  return all.filter((h) => h.level === 3 && h.offset > host.offset && /adapter$/.test(h.text));
}

function adapterSections(body: string, range?: { from: number; to: number }): string[] {
  return adapterHeadings(body)
    .filter((h) => !range || (h.offset >= range.from && h.offset < range.to))
    .map((h) => h.text.replace(/ adapter$/, ""));
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
  const portable = occurrences(body, PORTABLE_START);
  const portableEnd = occurrences(body, PORTABLE_END);
  const claude = occurrences(body, CLAUDE_START);
  const claudeEnd = occurrences(body, CLAUDE_END);
  return { frontmatter, body, portable, portableEnd, claude, claudeEnd };
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

      it("delimits exactly one portable contract followed by exactly one Claude-only adapter block", () => {
        expect(skill.portable).toHaveLength(1);
        expect(skill.portableEnd).toHaveLength(1);
        expect(skill.claude).toHaveLength(1);
        expect(skill.claudeEnd).toHaveLength(1);
        expect(skill.portable[0]).toBeLessThan(skill.portableEnd[0]);
        expect(skill.portableEnd[0]).toBeLessThan(skill.claude[0]);
        expect(skill.claude[0]).toBeLessThan(skill.claudeEnd[0]);
        const contractBody = skill.body.slice(skill.portable[0] + PORTABLE_START.length, skill.portableEnd[0]).trim();
        expect(contractBody.length).toBeGreaterThan(0);
      });

      it("references the shipped shared pairing contract from the portable block", () => {
        const contractBody = skill.body.slice(skill.portable[0], skill.portableEnd[0]);
        const ref = contractBody.match(/`(\.\.\/pairing-contract\.md)`/);
        expect(ref).not.toBeNull();
        const resolved = path.resolve(PLUGIN_ROOT, "skills", name, ref?.[1] ?? "");
        expect(fs.existsSync(resolved)).toBe(true);
        expect(path.relative(PLUGIN_ROOT, resolved)).toBe(path.join("skills", "pairing-contract.md"));
        const shipped = readJson<{ files: string[] }>("package.json").files;
        expect(shipped).toContain("skills/");
      });

      it("places the non-Claude host adapters outside the Claude-only block", () => {
        const outside = adapterSections(skill.body, { from: 0, to: skill.claude[0] });
        expect(outside).toContain("Cursor Agent");
        expect(outside).not.toContain("Claude Code");
        expect(adapterSections(skill.body, { from: skill.claude[0], to: skill.claudeEnd[0] })).toEqual(["Claude Code"]);
      });
    });
  }

  it("codex-pair keeps its Pi adapter while grok-pair stays Claude + Cursor only", () => {
    const codex = parsePairSkill("codex-pair");
    const grok = parsePairSkill("grok-pair");
    expect(adapterSections(codex.body)).toEqual(["Pi", "Cursor Agent", "Claude Code"]);
    expect(adapterSections(grok.body)).toEqual(["Cursor Agent", "Claude Code"]);
    const piSkills = readJson<{ pi: { skills: string[] } }>("package.json").pi.skills;
    expect(piSkills).toContain("./skills/codex-pair/SKILL.md");
    expect(piSkills).not.toContain("./skills/grok-pair/SKILL.md");
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
    const cursor = adapterBody(parsePairSkill("codex-pair").body, "Cursor Agent");
    const calls = jsonCodeBlocks(cursor).find(Array.isArray) as
      | Array<{ tool: string; arguments: Record<string, unknown> }>
      | undefined;
    expect(calls?.map((call) => call.tool)).toEqual(["ask-codex", "ask-llm"]);
    for (const call of calls ?? []) {
      expect(Object.keys(call.arguments).sort()).toEqual(
        [
          ...(call.tool === "ask-llm" ? ["provider"] : ["sandbox"]),
          "includeDirs",
          "model",
          "prompt",
          "reasoningEffort",
          "sessionId",
        ].sort(),
      );
      expect(call.arguments.model).toBe("<required exact ID>");
      expect(call.arguments.reasoningEffort).toBe("<required effort>");
      expect(call.arguments.sessionId).toBe("");
    }
  });
});

describe("shared pairing contract", () => {
  const contract = readFile("skills/pairing-contract.md");

  it("is a plain shared document, not a discoverable skill", () => {
    expect(parseMarkdownFrontmatter(contract).frontmatter).toEqual({});
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "skills", "pairing-contract", "SKILL.md"))).toBe(false);
  });
});
