// Renders a review prompt from a vendored template + fixture inputs.
// Mirrors packages/claude-plugin/scripts/lib/prompt.mjs::buildReviewPrompt
// but loads from an arbitrary template path so the benchmark can A/B
// compare two prompts. Substitution order matches the production logic
// exactly so render-equivalence holds.

import { readFileSync } from "node:fs";

export function renderPrompt({ templatePath, filePath, fileContent, toolName, projectContext, partialView = false }) {
  const template = readFileSync(templatePath, "utf-8");
  const contextBlock = projectContext.trim()
    ? `## Project context\n\n${projectContext.trim()}\n\n`
    : "";
  const partialViewBlock = partialView
    ? "## IMPORTANT: this is a partial view\n\nThe file is larger than the configured size cap. Only a slice is shown below (file header + git diff against HEAD, OR head + tail). Flag concerns ONLY if they are visible in this slice — do NOT speculate about omitted code. If you can't see enough to judge, prefer NONE over manufactured concerns.\n\n"
    : "";
  return template
    .replace("{{CONTEXT_BLOCK}}", contextBlock)
    .replace("{{PARTIAL_VIEW_BLOCK}}", partialViewBlock)
    .replace("{{TOOL_NAME}}", toolName)
    .replace("{{FILE_PATH}}", filePath)
    .replace("{{FILE_CONTENT}}", fileContent);
}
