import { describe, expect, it } from "vitest";
import { listFiles, listSubdirs, parseMarkdownFrontmatter, readFile } from "./_helpers.js";

const oldSkillNames = [
  "antigravity-review",
  "brainstorm",
  "brainstorm-all",
  "codex-image",
  "codex-pair",
  "codex-pair-ack",
  "codex-pair-pause",
  "codex-pair-resume",
  "codex-review",
  "codex-verify",
  "compare",
  "fable-review",
  "gemini-review",
  "grok-pair",
  "grok-review",
  "multi-review",
  "ollama-review",
  "sol-review",
];
const namespaced = (old: string) => (old === "codex-review" ? "ask-llm-review" : `ask-llm-${old}`);
const expectedSkills = oldSkillNames.map(namespaced);
const allowedAgentSkillFields = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
  "disable-model-invocation",
]);

const expectedAgents = [
  "antigravity-reviewer.md",
  "brainstorm-coordinator.md",
  "codex-reviewer.md",
  "codex-verifier.md",
  "fable-reviewer.md",
  "gemini-reviewer.md",
  "grok-reviewer.md",
  "ollama-reviewer.md",
  "sol-reviewer.md",
];

describe("skills/", () => {
  it("contains the namespaced skills and one old-name pointer for each", () => {
    const dirs = listSubdirs("skills").sort();
    expect(dirs).toEqual([...expectedSkills, ...oldSkillNames].sort());
  });

  it.each([...expectedSkills, ...oldSkillNames])("%s skill has SKILL.md with required frontmatter", (skillName) => {
    const content = readFile(`skills/${skillName}/SKILL.md`);
    const { frontmatter } = parseMarkdownFrontmatter(content);

    expect(frontmatter.name).toBe(skillName);
    expect(frontmatter.description).toBeTruthy();
    expect(typeof frontmatter.description).toBe("string");
    expect((frontmatter.description as string).trim().length).toBeGreaterThan(0);
  });

  it.each(expectedSkills)("%s is strict Agent Skills frontmatter", (skill) => {
    const content = readFile(`skills/${skill}/SKILL.md`);
    const { frontmatter } = parseMarkdownFrontmatter(content);
    expect(Object.keys(frontmatter).every((field) => allowedAgentSkillFields.has(field))).toBe(true);
    expect(String(frontmatter.name)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(String(frontmatter.name).length).toBeLessThanOrEqual(64);
    expect(String(frontmatter.description).length).toBeLessThanOrEqual(1024);
  });
});

describe("agents/", () => {
  it("contains the expected set of agent files", () => {
    const files = listFiles("agents", ".md").sort();
    expect(files).toEqual(expectedAgents.sort());
  });

  it.each(expectedAgents)("%s has required frontmatter fields", (agentFile) => {
    const content = readFile(`agents/${agentFile}`);
    const { frontmatter } = parseMarkdownFrontmatter(content);

    expect(frontmatter.name).toBeTruthy();
    expect(frontmatter.description).toBeTruthy();
    expect(typeof frontmatter.description).toBe("string");
    expect((frontmatter.description as string).trim().length).toBeGreaterThan(0);
  });

  it.each(expectedAgents)("%s declares a model and color", (agentFile) => {
    const { frontmatter } = parseMarkdownFrontmatter(readFile(`agents/${agentFile}`));
    expect(frontmatter.model).toBeTruthy();
    expect(frontmatter.color).toBeTruthy();
  });

  it("each reviewer agent has its provider's MCP tool in the tools list", () => {
    const cases: Array<{ file: string; tool: string }> = [
      { file: "gemini-reviewer.md", tool: "mcp__gemini__ask-gemini" },
      { file: "codex-reviewer.md", tool: "mcp__codex__ask-codex" },
      { file: "grok-reviewer.md", tool: "mcp__grok__ask-grok" },
      { file: "ollama-reviewer.md", tool: "mcp__ollama__ask-ollama" },
      { file: "antigravity-reviewer.md", tool: "mcp__antigravity__ask-antigravity" },
    ];
    for (const { file, tool } of cases) {
      const { frontmatter } = parseMarkdownFrontmatter(readFile(`agents/${file}`));
      const tools = frontmatter.tools;
      expect(Array.isArray(tools)).toBe(true);
      expect(tools as string[]).toContain(tool);
    }
  });

  it.each(["gemini", "grok", "ollama", "antigravity"])(
    "%s-reviewer grants its provider tool and the unified tool",
    (provider) => {
      const { frontmatter } = parseMarkdownFrontmatter(readFile(`agents/${provider}-reviewer.md`));
      expect(frontmatter.tools).toEqual(
        expect.arrayContaining([`mcp__${provider}__ask-${provider}`, "mcp__ask-llm__ask-llm"]),
      );
    },
  );

  it("review agents are restricted from edit/write tools", () => {
    const reviewerAgents = [
      "gemini-reviewer.md",
      "codex-reviewer.md",
      "grok-reviewer.md",
      "ollama-reviewer.md",
      "antigravity-reviewer.md",
      "fable-reviewer.md",
      "sol-reviewer.md",
    ];
    for (const file of reviewerAgents) {
      const { frontmatter } = parseMarkdownFrontmatter(readFile(`agents/${file}`));
      const tools = frontmatter.tools as string[] | undefined;
      const disallowedTools = frontmatter.disallowedTools as string[] | undefined;
      if (tools) {
        expect(tools).not.toContain("Edit");
        expect(tools).not.toContain("Write");
        expect(tools).not.toContain("NotebookEdit");
      } else {
        expect(disallowedTools).toEqual(expect.arrayContaining(["Edit", "Write", "NotebookEdit"]));
      }
    }
  });

  it("pins the native models and effort for Fable and Sol reviewers", () => {
    const fable = parseMarkdownFrontmatter(readFile("agents/fable-reviewer.md")).frontmatter;
    const solContent = readFile("agents/sol-reviewer.md");
    const sol = parseMarkdownFrontmatter(solContent).frontmatter;
    expect(fable.model).toBe("fable");
    expect(fable.effort).toBe("high");
    expect(sol.model).toBe("opus");
    expect(sol.effort).toBe("high");
  });

  it("codex-reviewer grants split, plugin-bundled, and unified MCP tool identities", () => {
    const content = readFile("agents/codex-reviewer.md");
    const tools = parseMarkdownFrontmatter(content).frontmatter.tools as string[];
    expect(tools).toContain("mcp__codex__ask-codex");
    expect(tools).toContain("mcp__plugin_ask-llm_codex__ask-codex");
    expect(tools).toContain("mcp__ask-llm__ask-llm");
  });

  it("sol-reviewer inherits deferred MCP tools while denying write tools", () => {
    const solContent = readFile("agents/sol-reviewer.md");
    const frontmatter = parseMarkdownFrontmatter(solContent).frontmatter;
    expect(frontmatter.tools).toBeUndefined();
    expect(frontmatter.disallowedTools).toEqual(expect.arrayContaining(["Edit", "Write", "NotebookEdit"]));
  });
});

describe("brainstorm-coordinator permissions", () => {
  const { frontmatter } = parseMarkdownFrontmatter(readFile("agents/brainstorm-coordinator.md"));

  it("runs on opus with provider and research tools", () => {
    expect(frontmatter.model).toBe("opus");
    expect(frontmatter.tools).toEqual(
      expect.arrayContaining([
        "mcp__gemini__ask-gemini",
        "mcp__codex__ask-codex",
        "mcp__ollama__ask-ollama",
        "mcp__antigravity__ask-antigravity",
        "WebFetch",
        "WebSearch",
      ]),
    );
  });
});

describe("codex-verifier permissions", () => {
  const { frontmatter } = parseMarkdownFrontmatter(readFile("agents/codex-verifier.md"));

  it("grants split, plugin-bundled, and unified MCP tools while denying writes", () => {
    expect(frontmatter.tools).toEqual(
      expect.arrayContaining([
        "mcp__codex__ask-codex",
        "mcp__plugin_ask-llm_codex__ask-codex",
        "mcp__ask-llm__ask-llm",
      ]),
    );
    for (const tool of ["Edit", "Write", "NotebookEdit"]) {
      expect(frontmatter.tools).not.toContain(tool);
    }
  });
});
