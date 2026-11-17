import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MCP_DEFINITIONS, mcpDefinitionPin, pinMcpDefinition, skillAgreementErrors } from "./sync-plugin-manifests.ts";

const ROOT = resolve(import.meta.dirname, "..");
let copy: string;

function fixture(): string {
  copy = mkdtempSync(join(tmpdir(), "ask-llm-skill-agreement-"));
  for (const path of [
    "packages/llm-mcp/package.json",
    "packages/llm-mcp/server.json",
    "packages/llm-mcp/skills",
    "packages/llm-mcp/src/skills.ts",
    "packages/llm-mcp/.cursor-plugin",
    ".github/workflows/ci.yml",
  ]) {
    cpSync(join(ROOT, path), join(copy, path), { recursive: true });
  }
  return copy;
}

function edit(root: string, path: string, change: (text: string) => string): void {
  writeFileSync(join(root, path), change(readFileSync(join(root, path), "utf8")));
}

afterEach(() => copy && rmSync(copy, { recursive: true, force: true }));

describe("skill list, Pi manifest and packed skills/ agreement", () => {
  it("passes on the repository as committed", () => {
    expect(skillAgreementErrors(ROOT)).toEqual([]);
  });

  it("rejects a namespaced skill whose frontmatter name differs from its folder", () => {
    const root = fixture();
    edit(root, "packages/llm-mcp/skills/ask-llm-compare/SKILL.md", (text) =>
      text.replace("name: ask-llm-compare", "name: compare"),
    );
    expect(skillAgreementErrors(root)).toContain("skills/ask-llm-compare: frontmatter name is compare");
  });

  it("rejects an old-name folder that does not point at an existing namespaced twin", () => {
    const root = fixture();
    rmSync(join(root, "packages/llm-mcp/skills/ask-llm-compare"), { recursive: true });
    expect(skillAgreementErrors(root)).toContain("skills/compare: points at missing ../ask-llm-compare/SKILL.md");
  });

  it("rejects skills in the Pi manifest, which reads them from the shared skills folder", () => {
    const root = fixture();
    edit(root, "packages/llm-mcp/package.json", (text) =>
      text.replace('"extensions": [', '"skills": ["./skills/ask-llm-review/SKILL.md"],\n    "extensions": ['),
    );
    expect(skillAgreementErrors(root)).toContain(
      "package.json pi: declares skills; Pi reads them from ~/.agents/skills",
    );
  });

  it("rejects a packed package that leaves out skills/", () => {
    const root = fixture();
    edit(root, "packages/llm-mcp/package.json", (text) => text.replace('"skills/"', '"skills-old/"'));
    expect(skillAgreementErrors(root)).toContain("package.json files: skills/ is not packed");
  });

  it("rejects a Cursor manifest entry with no skill folder", () => {
    const root = fixture();
    edit(root, "packages/llm-mcp/.cursor-plugin/plugin.json", (text) =>
      text.replace("./skills/ask-llm-grok-pair", "./skills/ask-llm-grok-pairing"),
    );
    expect(skillAgreementErrors(root)).toContain(
      ".cursor-plugin/plugin.json: ./skills/ask-llm-grok-pairing has no SKILL.md",
    );
  });

  it("rejects a CI skills CLI pin that differs from SKILLS_CLI_VERSION", () => {
    const root = fixture();
    edit(root, ".github/workflows/ci.yml", (text) => text.replaceAll("skills@1.7.0", "skills@1.8.0"));
    expect(skillAgreementErrors(root)).toContain("ci.yml: the Pi smoke must seed skills with skills@1.7.0");
  });
});

const launcher = (rootVariable: string) => `\${${rootVariable}}/scripts/plugin-mcp-server.mjs`;

describe("plugin MCP definition pins", () => {
  const version = JSON.parse(readFileSync(join(ROOT, "packages/llm-mcp/package.json"), "utf8")).version;
  const read = (file: string) => JSON.parse(readFileSync(join(ROOT, file), "utf8"));

  it("pins every committed plugin MCP definition to the package version", () => {
    expect(MCP_DEFINITIONS.map((definition) => definition.file)).toEqual([
      "packages/llm-mcp/.mcp.json",
      "packages/llm-mcp/mcp.json",
    ]);
    for (const definition of MCP_DEFINITIONS) {
      expect(mcpDefinitionPin(definition, read(definition.file))).toBe(version);
    }
  });

  it("keeps Registry versions equal to the package version", () => {
    const server = read("packages/llm-mcp/server.json");
    expect(server.version).toBe(version);
    expect(server.packages[0].version).toBe(version);
  });

  it("moves each pin to the new release during the version step and leaves the rest unchanged", () => {
    for (const definition of MCP_DEFINITIONS) {
      const config = read(definition.file);
      const pinned = pinMcpDefinition(definition, config, "99.0.0");
      expect(pinned.mcpServers[definition.server].args).toEqual([
        `\${${definition.rootVariable}}/scripts/plugin-mcp-server.mjs`,
        definition.server,
        "99.0.0",
      ]);
      expect({ ...pinned, mcpServers: {} }).toEqual({ ...config, mcpServers: {} });
      expect(config.mcpServers[definition.server].args[2]).toBe(version);
      expect(pinMcpDefinition(definition, pinned, "99.0.0")).toBeNull();
    }
  });

  it.each([
    ["an npx launch", { mcpServers: { codex: { command: "npx", args: ["-y", "@ask-llm/codex-mcp"] } } }],
    [
      "a launch without a version",
      {
        mcpServers: {
          codex: { command: "node", args: [launcher("CLAUDE_PLUGIN_ROOT"), "codex"] },
        },
      },
    ],
    [
      "another plugin root variable",
      {
        mcpServers: {
          codex: { command: "node", args: [launcher("CURSOR_PLUGIN_ROOT"), "codex", "1.0.0"] },
        },
      },
    ],
    [
      "a second bundled server",
      {
        mcpServers: {
          codex: { command: "node", args: [launcher("CLAUDE_PLUGIN_ROOT"), "codex", "1.0.0"] },
          grok: { command: "npx", args: ["-y", "@ask-llm/grok-mcp"] },
        },
      },
    ],
  ])("rejects %s in the Claude definition", (_name, config) => {
    expect(() => mcpDefinitionPin(MCP_DEFINITIONS[0], config)).toThrow(
      `packages/llm-mcp/.mcp.json: must hold only "codex" running node ${launcher("CLAUDE_PLUGIN_ROOT")} codex <version>`,
    );
  });

  it("rewrites both pins when the version step bumps the package, and --check rejects a stale pin", () => {
    const root = fixture();
    for (const path of [
      "scripts/sync-plugin-manifests.ts",
      ".claude-plugin/marketplace.json",
      "packages/llm-mcp/.claude-plugin",
      "packages/llm-mcp/.mcp.json",
      "packages/llm-mcp/mcp.json",
    ]) {
      cpSync(join(ROOT, path), join(root, path), { recursive: true });
    }
    const script = join(root, "scripts/sync-plugin-manifests.ts");
    const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    edit(root, "packages/llm-mcp/package.json", (text) =>
      text.replace(`"version": "${version}"`, '"version": "99.0.0"'),
    );

    const stale = run("--check");
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain(
      "packages/llm-mcp/.mcp.json, packages/llm-mcp/mcp.json must match package.json version 99.0.0",
    );

    const synced = run();
    expect(synced.status, synced.stderr).toBe(0);
    for (const definition of MCP_DEFINITIONS) {
      expect(mcpDefinitionPin(definition, JSON.parse(readFileSync(join(root, definition.file), "utf8")))).toBe(
        "99.0.0",
      );
    }
    const server = JSON.parse(readFileSync(join(root, "packages/llm-mcp/server.json"), "utf8"));
    expect(server.version).toBe("99.0.0");
    expect(server.packages[0].version).toBe("99.0.0");
    expect(run("--check").status).toBe(0);
    edit(root, "packages/llm-mcp/server.json", (text) => text.replaceAll("99.0.0", "0.2.0"));
    expect(run("--check").stderr).toContain("packages/llm-mcp/server.json must match");
  });
});
