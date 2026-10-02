import type { HostId } from "./registry.js";

// Tools Pi registers natively with the input schemas the MCP server advertises.
export const SHARED_TOOLS = ["ask-llm", "multi-llm", "ask-cursor-agent"] as const;
export const MCP_ONLY_TOOLS = ["ping", "get-usage-stats", "diagnose"] as const;
export const PI_DEPRECATED_ALIASES = [
  "ask-codex",
  "ask-gemini",
  "ask-grok",
  "ask-ollama",
  "ask-antigravity",
  "ask-multi",
] as const;

export const PARITY_HOSTS: Array<{ id: HostId; name: string }> = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "cursor", name: "Cursor" },
  { id: "agy", name: "Antigravity" },
  { id: "grok", name: "Grok Build" },
  { id: "gemini", name: "Gemini" },
  { id: "pi", name: "Pi" },
  { id: "claude-desktop", name: "Claude Desktop" },
  { id: "opencode", name: "OpenCode" },
];

export const PARITY_ROWS = ["tools", "skills", "options", "diagnostics", "pairing", "subagents", "Stop gate"] as const;
export type ParityRow = (typeof PARITY_ROWS)[number];

const MCP_TOOLS = `MCP: ${[...SHARED_TOOLS, ...MCP_ONLY_TOOLS].join(", ")}`;
const SHARED_SKILLS = "shared skills folder `~/.agents/skills`, filled by `ask-llm setup`";
const SKILL_PAIRING = "on demand through the `ask-llm-codex-pair` skill; no per-edit review";
const INLINE = "none; reviews run inline";

function row(common: string, overrides: Partial<Record<HostId, string>>): Record<HostId, string> {
  return Object.fromEntries(PARITY_HOSTS.map(({ id }) => [id, overrides[id] ?? common])) as Record<HostId, string>;
}

// Rendered into docs/HOST-PARITY.md and printed by `ask-llm doctor` for each installed host.
export const HOST_PARITY: Record<ParityRow, Record<HostId, string>> = {
  tools: row(MCP_TOOLS, {
    pi: `native ${SHARED_TOOLS.join(", ")} with the MCP input schemas; ${PI_DEPRECATED_ALIASES.join(", ")} as deprecated aliases`,
  }),
  skills: row(SHARED_SKILLS, {
    claude: "the Claude plugin, installed by `ask-llm setup`",
    agy: "`~/.gemini/config/skills`; `ask-llm setup` prints the copy command",
    grok: "`~/.grok/skills`, filled by `ask-llm setup`",
    "claude-desktop": "none (tools only)",
  }),
  options: row("every `ask-llm` option reaches the executor unchanged; `provider` lists the providers found at start", {
    pi: "same options and checks; `provider` lists every eligible provider and an undetected one fails at call time",
  }),
  diagnostics: row("`diagnose` tool and `ask-llm doctor`", { pi: "`ask-llm doctor` (no `diagnose` tool)" }),
  pairing: row(SKILL_PAIRING, {
    claude: "per-edit codex-pair hooks from the plugin, off until `/codex-pair` consent",
    pi: "per-edit codex-pair extension, off until project trust, the marker and `/codex-pair` consent",
    "claude-desktop": "none",
  }),
  subagents: row(INLINE, { claude: "isolated reviewer agents from the plugin", "claude-desktop": "none" }),
  "Stop gate": row("none", {
    claude: "blocks the turn on a HIGH codex-pair finding",
    pi: "none; codex-pair findings are non-blocking",
  }),
};

export function parityRowsFor(id: HostId): Record<ParityRow, string> {
  return Object.fromEntries(PARITY_ROWS.map((name) => [name, HOST_PARITY[name][id]])) as Record<ParityRow, string>;
}

export function renderParityTable(): string {
  const header = `| | ${PARITY_HOSTS.map((host) => host.name).join(" | ")} |`;
  const divider = `|---|${PARITY_HOSTS.map(() => "---").join("|")}|`;
  const rows = PARITY_ROWS.map(
    (name) => `| ${name} | ${PARITY_HOSTS.map((host) => HOST_PARITY[name][host.id]).join(" | ")} |`,
  );
  return [header, divider, ...rows].join("\n");
}
