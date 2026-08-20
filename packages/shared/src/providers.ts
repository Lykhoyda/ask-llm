/**
 * Single source of truth for the provider list (ADR-128).
 *
 * Every provider-name enum, type union, or user-facing provider list in the
 * monorepo must derive from this tuple — hand-maintained copies drifted when
 * antigravity was added (see BUGS.md 2026-07-02 audit entry).
 */
export const PROVIDERS = ["gemini", "codex", "claude", "grok", "ollama", "antigravity"] as const;

export type ProviderName = (typeof PROVIDERS)[number];

export const CURSOR_PROVIDERS = ["claude", "codex", "gemini", "grok"] as const;

export type CursorProviderName = (typeof CURSOR_PROVIDERS)[number];

const CURSOR_MODEL_FAMILY_SIGNALS: ReadonlyArray<readonly [CursorProviderName, readonly string[]]> = [
  ["grok", ["grok"]],
  ["claude", ["claude", "sonnet", "opus", "haiku"]],
  ["codex", ["gpt", "codex", "o1", "o3", "o4"]],
  ["gemini", ["gemini"]],
];

export function cursorModelFamily(modelId: string): CursorProviderName | null {
  const tokens = modelId
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);
  for (const [provider, signals] of CURSOR_MODEL_FAMILY_SIGNALS) {
    if (
      tokens.some((token) =>
        signals.some(
          (signal) => token === signal || (token.startsWith(signal) && /^[0-9]/.test(token.slice(signal.length))),
        ),
      )
    ) {
      return provider;
    }
  }
  return null;
}
