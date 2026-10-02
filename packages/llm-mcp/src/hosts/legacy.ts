import { basename } from "node:path";

const UNIFIED_PACKAGE = "@ask-llm/mcp";
const PROVIDERS = ["antigravity", "claude", "codex", "gemini", "grok", "ollama"];
const SPLIT_PACKAGES = PROVIDERS.map((provider) => `@ask-llm/${provider}-mcp`);

// Every npm name an Ask LLM server was published under, mapped to the package that carries it now.
const PACKAGE_NAMES: Record<string, string> = {
  [UNIFIED_PACKAGE]: UNIFIED_PACKAGE,
  "ask-llm-mcp": UNIFIED_PACKAGE,
  ...Object.fromEntries(SPLIT_PACKAGES.map((name) => [name, name])),
  "ask-antigravity-mcp": "@ask-llm/antigravity-mcp",
  "@anton-lykhoyda/ask-claude-mcp": "@ask-llm/claude-mcp",
  "ask-codex-mcp": "@ask-llm/codex-mcp",
  "ask-gemini-mcp": "@ask-llm/gemini-mcp",
  "ask-ollama-mcp": "@ask-llm/ollama-mcp",
};

// The server bins, unchanged across those renames.
const BINS: Record<string, string> = {
  "ask-llm-mcp": UNIFIED_PACKAGE,
  ...Object.fromEntries(PROVIDERS.map((provider) => [`ask-${provider}-mcp`, `@ask-llm/${provider}-mcp`])),
};

const NPX_FLAGS = new Set(["-y", "--yes", "-q", "--quiet"]);

function lookup(table: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function packageOf(spec: string): string | undefined {
  const version = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  return lookup(PACKAGE_NAMES, version === -1 ? spec : spec.slice(0, version));
}

// The package an MCP entry launches through an earlier install route: an `npx` package spec, a server
// bin on PATH, or a split server's installed bin or `dist/cli.js`. Another absolute install of the
// unified server is not an earlier route, and an entry with extra arguments is the user's own.
export function legacyPackage(command: string[] | undefined): string | undefined {
  if (!command || command.length === 0) return undefined;
  const [program, ...args] = command;
  const name = basename(program);
  if (name === "npx") {
    const specs = args.filter((arg) => !NPX_FLAGS.has(arg));
    return specs.length === 1 ? packageOf(specs[0]) : undefined;
  }
  const script = name === "node" && args.length === 1 ? args[0] : args.length === 0 ? program : undefined;
  if (script === undefined) return undefined;
  const installed = /node_modules\/((?:@[^/]+\/)?[^/]+)\/dist\/cli\.js$/.exec(script);
  if (installed) {
    const found = lookup(PACKAGE_NAMES, installed[1]);
    return found === UNIFIED_PACKAGE ? undefined : found;
  }
  if (name === "node") return undefined;
  const bin = lookup(BINS, name);
  return bin === UNIFIED_PACKAGE && program.includes("/") ? undefined : bin;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const MENTION = new RegExp(
  `(?<![\\w@.-])(${[...Object.keys(PACKAGE_NAMES), ...Object.keys(BINS)].map(escapeRegExp).join("|")})(?![\\w-])`,
);

// For an entry setup cannot read in full: the Ask LLM package its raw text names, if any.
export function mentionedPackage(text: string | undefined): string | undefined {
  const found = text === undefined ? undefined : MENTION.exec(text)?.[1];
  return found === undefined ? undefined : (lookup(PACKAGE_NAMES, found) ?? lookup(BINS, found));
}
