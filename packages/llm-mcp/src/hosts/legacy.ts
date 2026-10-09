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

export function legacyPackage(command: string[] | undefined): string | undefined {
  if (!command || command.length === 0) return undefined;
  const [program, ...args] = command;
  if (program === "npx") {
    const specs = args.filter((arg) => !NPX_FLAGS.has(arg));
    return specs.length === 1 ? packageOf(specs[0]) : undefined;
  }
  return args.length === 0 ? lookup(BINS, program) : undefined;
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
