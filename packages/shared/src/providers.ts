/**
 * Single source of truth for the provider list (ADR-128).
 *
 * Every provider-name enum, type union, or user-facing provider list in the
 * monorepo must derive from this tuple — hand-maintained copies drifted when
 * antigravity was added (see BUGS.md 2026-07-02 audit entry).
 */
export const PROVIDERS = ["gemini", "codex", "ollama", "antigravity"] as const;

export type ProviderName = (typeof PROVIDERS)[number];
