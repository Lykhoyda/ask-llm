import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { skillAgreementErrors } from "./sync-plugin-manifests.ts";

const ROOT = resolve(import.meta.dirname, "..");
let copy: string;

function fixture(): string {
  copy = mkdtempSync(join(tmpdir(), "ask-llm-skill-agreement-"));
  for (const path of [
    "packages/llm-mcp/package.json",
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
