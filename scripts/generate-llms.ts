import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = "https://lykhoyda.github.io/ask-llm";
const promise =
  "Get a second opinion on your code or plan, inside your coding assistant, using the model subscriptions you already have.";

const sections: Record<string, string[]> = {
  Start: ["start/install", "start/first-review", "start/upgrade-remove"],
  Workflows: [
    "workflows/review-changes",
    "workflows/challenge-plan",
    "workflows/compare-answers",
    "workflows/brainstorm",
  ],
  Compatibility: ["compatibility/hosts", "compatibility/claude-code", "compatibility/cursor", "compatibility/pi"],
  Providers: [
    "providers/codex",
    "providers/claude",
    "providers/grok",
    "providers/antigravity",
    "providers/ollama",
    "providers/gemini",
  ],
  Operation: ["operation/diagnostics", "operation/authentication", "operation/data-flow", "operation/costs"],
  Advanced: [
    "advanced/codex-pair",
    "advanced/grok-pair",
    "advanced/manual-configuration",
    "advanced/enterprise-gemini",
  ],
  Reference: [
    "reference/tools",
    "reference/cli",
    "reference/environment-variables",
    "reference/skills",
    "reference/migration",
  ],
  Resources: ["resources/troubleshooting", "resources/faq"],
};

function page(path: string): string {
  return readFileSync(join(root, "apps/docs", `${path}.md`), "utf8")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .trim();
}

function title(source: string): string {
  return source.match(/^# (.+)$/m)?.[1] ?? "Ask LLM";
}

function removeScriptBlocksAndComments(source: string): string {
  let previous: string;
  do {
    previous = source;
    source = source.replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, "\n").replace(/<!--[\s\S]*?-->/g, "\n");
  } while (source !== previous);
  return source;
}

// Regenerate text from canonical pages; old routes remain redirects, not a second corpus.
export function llmsFiles(): Record<string, string> {
  const intro = `# Ask LLM\n\n> Second opinions for coding agents. ${promise}\n\nFor individual developers and small teams who already use a coding assistant and another model subscription. Review changes or challenge a plan without API keys, copy-paste, or leaving the session.\n\nInstall on Linux or macOS with Node.js 24+, then select your host and confirm the preview:\n\n\`\`\`bash\nnpm i -g @ask-llm/mcp && ask-llm setup\n\`\`\`\n\nInstall and sign in to the provider separately. Then ask: “Ask Codex to review my staged changes for bugs and missing error handling.” Choose a reviewer from a different vendor. Calls consume account quota or billing; Grok's metered API is explicit. Local Ollama models are supported. Antigravity refuses by default and opt-in has no read-only guarantee. Ask LLM sends no telemetry. Agreement between models is not proof of correctness.\n`;
  let index = intro;
  let full = intro;
  for (const [section, paths] of Object.entries(sections)) {
    index += `\n## ${section}\n\n`;
    full += `\n## ${section}\n\n`;
    for (const path of paths) {
      const source = page(path);
      const link = `- [${title(source)}](${site}/${path}.html)\n`;
      index += link;
      // Reference and unchanged provider pages keep legacy instructions at their URLs.
      if (section === "Reference" || section === "Providers") {
        full += link;
        continue;
      }
      const readable = removeScriptBlocksAndComments(
        source
          .replace(
            /<SetupTabs\s*\/>/g,
            "See the install command above; select your host, inspect the preview, and confirm.",
          )
          .replace(/<[A-Z][^>]*\/>/g, "\n"),
      )
        .replace(/<TroubleshootingModal\b([^>]*)>/g, (_, attributes: string) => {
          const { title, preview } = Object.fromEntries(
            Array.from(attributes.matchAll(/\b(title|preview)=(["'])(.*?)\2/gs), (match) => [match[1], match[3]]),
          );
          return `### ${title}\n\n${preview}`;
        })
        .replace(/<\/TroubleshootingModal>/g, "\n")
        .replace(/\]\(\/(?!\/)([^)]+)\)/g, `](${site}/$1)`);
      full += `### ${title(source)}\n\nSource: ${site}/${path}.html\n\n${readable.replace(/^# .+\n/, "").trim()}\n\n`;
    }
  }
  index += `\n[Full workflow and operation text](${site}/llms-full.txt)\n`;
  return {
    "apps/docs/public/llms.txt": index,
    "apps/docs/public/llms-full.txt": `${full.trimEnd()}\n`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [path, contents] of Object.entries(llmsFiles())) writeFileSync(join(root, path), contents);
  console.log("Regenerated llms.txt and llms-full.txt from canonical documentation.");
}
