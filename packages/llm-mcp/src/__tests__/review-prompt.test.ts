import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { renderPrompt } from "../../scripts/benchmark/lib/render-prompt.mjs";
import { buildReviewPrompt } from "../../scripts/lib/prompt.mjs";
import { PLUGIN_ROOT } from "./_helpers.js";

function fileSection(rendered: string): string {
  const match = rendered.match(/<file_content>\n([\s\S]*)\n<\/file_content>/);
  if (!match) throw new Error("rendered prompt has no <file_content> section");
  return match[1];
}

function render(fileContent: string, projectContext = "") {
  return buildReviewPrompt({
    filePath: "docs/x.md",
    fileContent,
    toolName: "Edit",
    projectContext,
    partialView: false,
  });
}

describe("buildReviewPrompt inserts untrusted text literally (#281)", () => {
  it.each([
    ["$`", "const s = `cost: $`;"],
    ["$&", 'const r = s.replace(/x/, "$&");'],
    ["$'", "echo '$'"],
    ["$$", "echo $$ > pid"],
  ])("keeps %s in file content verbatim", (_pattern, content) => {
    expect(fileSection(render(content))).toBe(content);
  });

  it.each([
    "- Typographic glyphs (`▮`, `→`, `$`, `⇀`) replace all hand-rolled SVG icons. Existing inline SVG icon markup on the homepage is removed.",
    "- Typographic glyphs (`▮`, `→`, `$`, `⇀`, `↽`) instead of SVG icons. No hand-rolled icon paths.",
  ])("renders the #281 incident line without pasting the prompt into the file: %s", (line) => {
    const rendered = render(line);
    expect(fileSection(rendered)).toBe(line);
    expect(rendered.length).toBe(render("").length + line.length);
  });

  it("renders glyph-only content byte-identically", () => {
    const content = "- Glyphs: ▮ → ⇀ ↽ ─ │ ┌ ┐";
    const rendered = render(content);
    expect(fileSection(rendered)).toBe(content);
    expect(rendered).toContain(`<file_content>\n${content}\n</file_content>`);
  });

  it("keeps $ patterns in project context verbatim", () => {
    const context = "Prices render as `$` then digits; $& and $' and $$ are literal.";
    expect(render("code", context)).toContain(`\n\n${context}\n\n`);
  });

  it("does not let a {{FILE_CONTENT}} token in context hijack the file insertion", () => {
    const context = "Template docs mention {{FILE_CONTENT}} and {{FILE_PATH}}.";
    const rendered = render("the real file", context);
    expect(rendered).toContain(context);
    expect(fileSection(rendered)).toBe("the real file");
  });
});

describe("benchmark renderPrompt inserts untrusted text literally", () => {
  const templatePath = path.join(PLUGIN_ROOT, "scripts", "benchmark", "templates", "baseline.txt");

  function renderBenchmark(fileContent: string, projectContext: string) {
    return renderPrompt({ templatePath, filePath: "code.ts", fileContent, toolName: "Edit", projectContext });
  }

  it("keeps $ patterns in file content and context verbatim", () => {
    const content = "const s = `cost: $`; echo $$ $& $'";
    const context = "Prices render as `$` then digits.";
    const rendered = renderBenchmark(content, context);
    expect(fileSection(rendered)).toBe(content);
    expect(rendered).toContain(`\n\n${context}\n\n`);
  });

  it("does not let a {{FILE_CONTENT}} token in context hijack the file insertion", () => {
    const rendered = renderBenchmark("the real file", "Mentions {{FILE_CONTENT}}.");
    expect(rendered).toContain("Mentions {{FILE_CONTENT}}.");
    expect(fileSection(rendered)).toBe("the real file");
  });
});
