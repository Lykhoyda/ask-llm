import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_ROOT, REPO_ROOT, readJson } from "./_helpers.js";

interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: { name: string; url?: string };
  repository?: string;
  license?: string;
  keywords?: string[];
}

interface MarketplaceEntry {
  name: string;
  version: string;
  source: { source: string; url?: string; path?: string };
  description: string;
  author?: { name: string };
  license?: string;
  keywords?: string[];
}

interface MarketplaceFile {
  name: string;
  owner: { name: string; email?: string };
  metadata: { description: string; version: string };
  plugins: MarketplaceEntry[];
}

describe("plugin.json manifest", () => {
  const manifest = readJson<PluginManifest>(".claude-plugin/plugin.json");

  it("declares required identity fields", () => {
    expect(manifest.name).toBe("ask-llm");
    expect(manifest.description).toMatch(/.+/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("includes the standard keyword set (all four providers)", () => {
    expect(manifest.keywords).toContain("gemini");
    expect(manifest.keywords).toContain("codex");
    expect(manifest.keywords).toContain("ollama");
    expect(manifest.keywords).toContain("antigravity");
  });

  it("description names all four providers", () => {
    for (const provider of ["Gemini", "Codex", "Ollama", "Antigravity"]) {
      expect(manifest.description).toContain(provider);
    }
  });

  it("declares author and repository", () => {
    expect(manifest.author?.name).toBeTruthy();
    expect(manifest.repository).toMatch(/github\.com/);
  });
});

describe("marketplace.json", () => {
  const marketplace = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, ".claude-plugin", "marketplace.json"), "utf-8"),
  ) as MarketplaceFile;

  it("declares the marketplace name", () => {
    expect(marketplace.name).toBe("ask-llm-plugins");
  });

  it("contains the ask-llm plugin entry", () => {
    const entry = marketplace.plugins.find((p) => p.name === "ask-llm");
    expect(entry).toBeDefined();
    expect(entry?.source.source).toBe("git-subdir");
    expect(entry?.source.path).toBe("packages/claude-plugin");
  });

  it("plugin entry version is in valid semver shape", () => {
    const entry = marketplace.plugins.find((p) => p.name === "ask-llm");
    expect(entry?.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("plugin entry metadata names antigravity alongside the other providers", () => {
    const entry = marketplace.plugins.find((p) => p.name === "ask-llm") as
      | { description?: string; keywords?: string[] }
      | undefined;
    expect(entry?.description).toContain("Antigravity");
    expect(entry?.keywords).toContain("antigravity");
  });
});

describe("hooks.json", () => {
  const hooks = readJson<{ hooks: Record<string, unknown[]> }>("hooks/hooks.json");

  it("registers the Stop hook → codex-pair-stop-gate.mjs", () => {
    expect(hooks.hooks.Stop).toBeDefined();
    const cmd = (hooks.hooks.Stop as Array<{ hooks: Array<{ command: string }> }>)[0].hooks[0].command;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting a literal hook placeholder, not interpolation
    expect(cmd).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(cmd).toContain("codex-pair-stop-gate.mjs");
  });

  it("the stop-gate script exists on disk", () => {
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "scripts", "codex-pair-stop-gate.mjs"))).toBe(true);
  });

  it("PreToolUse hook is NOT present (removed in ADR-094)", () => {
    expect(hooks.hooks.PreToolUse).toBeUndefined();
  });

  it("declares the PostToolUse codex-pair hook for Edit/Write/MultiEdit", () => {
    expect(hooks.hooks.PostToolUse).toBeDefined();
    expect(Array.isArray(hooks.hooks.PostToolUse)).toBe(true);
    expect(hooks.hooks.PostToolUse).toHaveLength(1);
    const entry = (hooks.hooks.PostToolUse as Array<{ matcher: string }>)[0];
    expect(entry.matcher).toBe("Edit|Write|MultiEdit");
  });

  it("declares SessionStart and SessionEnd hooks for the broker lifecycle (ADR-090)", () => {
    expect(hooks.hooks.SessionStart).toBeDefined();
    expect(hooks.hooks.SessionEnd).toBeDefined();
  });

  it("all hook commands reference CLAUDE_PLUGIN_ROOT for portability", () => {
    const all = [
      ...(hooks.hooks.PostToolUse as Array<{ hooks: Array<{ command: string }> }>),
      ...(hooks.hooks.SessionStart as Array<{ hooks: Array<{ command: string }> }>),
      ...(hooks.hooks.SessionEnd as Array<{ hooks: Array<{ command: string }> }>),
    ];
    for (const entry of all) {
      expect(entry.hooks[0].command).toContain("$" + "{CLAUDE_PLUGIN_ROOT}");
    }
  });

  it("referenced script files exist on disk", () => {
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "scripts", "codex-pair-watch.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "scripts", "codex-pair-session.mjs"))).toBe(true);
  });

  it("pre-commit-review.sh is NOT present (deleted in ADR-094)", () => {
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "scripts", "pre-commit-review.sh"))).toBe(false);
  });
});

describe("dual-host package manifest", () => {
  const pkg = readJson<{
    private?: boolean;
    files: string[];
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
    pi: { extensions: string[]; skills: string[] };
    publishConfig: { access: string };
  }>("package.json");

  it("is public npm metadata with real provider ranges and a package-local license", () => {
    expect(pkg.private).not.toBe(true);
    expect(pkg.publishConfig.access).toBe("public");
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "LICENSE"))).toBe(true);
    expect(Object.values(pkg.dependencies).every((range) => !range.startsWith("workspace:"))).toBe(true);
    expect(pkg.dependencies).not.toHaveProperty("@ask-llm/shared");
  });

  it("declares one thin Pi extension and the canonical skills with Fable excluded", () => {
    expect(pkg.pi.extensions).toEqual(["./pi/extensions/index.ts"]);
    expect(pkg.pi.skills).toHaveLength(15);
    expect(pkg.pi.skills).toContain("./skills/codex-review/SKILL.md");
    expect(pkg.pi.skills).not.toContain("./skills/fable-review/SKILL.md");
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "pi", "extensions", "index.ts"))).toBe(true);
  });

  it("ships every runtime resource needed by both hosts", () => {
    for (const resource of [
      ".claude-plugin/",
      "agents/",
      "dist/",
      "hooks/",
      "LICENSE",
      "pi/",
      "prompts/",
      "scripts/lib/",
      "skills/",
    ]) {
      expect(pkg.files).toContain(resource);
    }
    expect(pkg.peerDependencies).toMatchObject({
      "@earendil-works/pi-ai": "*",
      "@earendil-works/pi-coding-agent": "*",
      typebox: "*",
    });
  });
});

describe("CLI binary references in package.json bin", () => {
  const pkg = readJson<{ bin: Record<string, string> }>("package.json");

  it("declares all four runner binaries", () => {
    expect(pkg.bin["ask-gemini-run"]).toBe("dist/run.js");
    expect(pkg.bin["ask-codex-run"]).toBe("dist/codex-run.js");
    expect(pkg.bin["ask-ollama-run"]).toBe("dist/ollama-run.js");
    expect(pkg.bin["ask-antigravity-run"]).toBe("dist/antigravity-run.js");
  });

  it("each declared binary source exists in src/", () => {
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "src", "run.ts"))).toBe(true);
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "src", "codex-run.ts"))).toBe(true);
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "src", "ollama-run.ts"))).toBe(true);
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "src", "antigravity-run.ts"))).toBe(true);
  });
});

