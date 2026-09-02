// apps/docs/.vitepress/theme/providers.ts
// Single source of truth for provider facts shown anywhere on the docs site.
// NOTE: must NOT be named *.data.ts — VitePress reserves that suffix for
// build-time data loaders, which strips named exports and breaks importers.
// Values are drift-checked against packages/*/src/constants.ts by
// scripts/check-docs-drift.mjs. Update BOTH when a default model changes.

export type ProviderId = "codex" | "claude" | "grok" | "antigravity" | "ollama" | "gemini" | "unified";

export interface ProviderDoc {
  id: ProviderId;
  name: string;
  pkg: string;
  serverName: string;
  cliInstall: string;
  defaultModel: string;
  fallbackModel?: string;
  // Reasoning effort applied to both the default and fallback models.
  defaultEffort?: string;
  status?: "enterprise" | "experimental" | "local";
  tier: "hero" | "supporting" | "unified";
  tagline: string;
  tools: string[];
  docPath: string;
}

export const PROVIDER_DOCS: Record<ProviderId, ProviderDoc> = {
  codex: {
    id: "codex",
    name: "Codex",
    pkg: "@ask-llm/codex-mcp",
    serverName: "codex",
    cliInstall: "npm install -g @openai/codex",
    defaultModel: "gpt-5.6-sol",
    fallbackModel: "gpt-5.6-terra",
    tier: "hero",
    tagline: "GPT-5.6 workhorse reviewer. Strongest code reasoning for targeted reviews and architecture critique.",
    tools: ["ask-codex", "ask-codex-edit", "get-usage-stats", "ping"],
    docPath: "/providers/codex",
  },
  claude: {
    id: "claude",
    name: "Claude",
    pkg: "@ask-llm/claude-mcp",
    serverName: "claude",
    cliInstall: "npm install -g @anthropic-ai/claude-code",
    defaultModel: "opus",
    fallbackModel: "sonnet",
    tier: "hero",
    tagline: "Opus-powered read-only reviewer for Codex CLI and other non-Claude hosts. The reverse path.",
    tools: ["ask-claude", "get-usage-stats", "ping"],
    docPath: "/providers/claude",
  },
  grok: {
    id: "grok",
    name: "Grok",
    pkg: "@ask-llm/grok-mcp",
    serverName: "grok",
    cliInstall: "# create an API key at https://console.x.ai/team/default/api-keys",
    defaultModel: "grok-4.6",
    defaultEffort: "high",
    tier: "supporting",
    tagline: "Grok 4.6 through xAI's metered API. Exact model selection with no fallback.",
    tools: ["ask-grok", "get-usage-stats", "ping"],
    docPath: "/providers/grok",
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    pkg: "@ask-llm/antigravity-mcp",
    serverName: "antigravity",
    cliInstall: "# install agy >=1.1.5 from https://antigravity.google, then log in once",
    defaultModel: "gemini-3.1-pro",
    fallbackModel: "gemini-3.5-flash",
    defaultEffort: "high",
    status: "experimental",
    tier: "supporting",
    tagline: "Subscription-backed second opinion via Google AI Pro/Ultra (agy).",
    tools: ["ask-antigravity", "get-usage-stats", "ping"],
    docPath: "/providers/antigravity",
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    pkg: "@ask-llm/ollama-mcp",
    serverName: "ollama",
    cliInstall: "# install from https://ollama.com, then: ollama pull qwen3.8:27b",
    defaultModel: "qwen3.8:27b",
    status: "local",
    tier: "supporting",
    tagline: "Local models. No API keys, fully private, zero cost.",
    tools: ["ask-ollama", "get-usage-stats", "ping"],
    docPath: "/providers/ollama",
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    pkg: "@ask-llm/gemini-mcp",
    serverName: "gemini",
    cliInstall: "npm install -g @google/gemini-cli && gemini login",
    defaultModel: "gemini-3.1-pro-preview",
    fallbackModel: "gemini-3.7-flash",
    status: "enterprise",
    tier: "supporting",
    tagline: "1M+ token context for whole-codebase reads. Enterprise seats only since 2026-06-18.",
    tools: ["ask-gemini", "ask-gemini-edit", "fetch-chunk", "get-usage-stats", "ping"],
    docPath: "/providers/gemini",
  },
  unified: {
    id: "unified",
    name: "Unified",
    pkg: "@ask-llm/mcp",
    serverName: "ask-llm",
    cliInstall: "# no extra CLI: auto-detects the provider CLIs you already have",
    defaultModel: "per provider",
    tier: "unified",
    tagline:
      "All providers in one server. Detects configured APIs and installed CLIs, routes each request, or fans one prompt out to several.",
    tools: ["ask-llm", "multi-llm", "get-usage-stats", "diagnose", "ping"],
    docPath: "/providers/unified",
  },
};

export const HERO_IDS: ProviderId[] = ["claude", "codex"];
export const SUPPORTING_IDS: ProviderId[] = ["grok", "antigravity", "ollama", "gemini"];

export function providerList(): ProviderDoc[] {
  return Object.values(PROVIDER_DOCS);
}
