import type { ProviderName } from "./providers.js";

export interface UsageStats {
  provider: ProviderName;
  model: string;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cachedTokens: number | undefined;
  thinkingTokens: number | undefined;
  durationMs: number;
  fellBack: boolean;
}

export interface SessionUsageSnapshot {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalThinkingTokens: number;
  totalDurationMs: number;
  fallbackCount: number;
  byProvider: Record<string, ProviderUsageSnapshot>;
  byModel: Record<string, ProviderUsageSnapshot>;
}

export interface ProviderUsageSnapshot {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
  durationMs: number;
  fellBack: number;
}

export interface SessionUsage {
  record: (stats: UsageStats) => void;
  snapshot: () => SessionUsageSnapshot;
  reset: () => void;
}

function emptyProviderSnapshot(): ProviderUsageSnapshot {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    thinkingTokens: 0,
    durationMs: 0,
    fellBack: 0,
  };
}

function addToBucket(bucket: ProviderUsageSnapshot, stats: UsageStats): void {
  bucket.calls += 1;
  bucket.inputTokens += stats.inputTokens ?? 0;
  bucket.outputTokens += stats.outputTokens ?? 0;
  bucket.cachedTokens += stats.cachedTokens ?? 0;
  bucket.thinkingTokens += stats.thinkingTokens ?? 0;
  bucket.durationMs += stats.durationMs;
  if (stats.fellBack) bucket.fellBack += 1;
}

export function createSessionUsage(): SessionUsage {
  let totalCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalThinkingTokens = 0;
  let totalDurationMs = 0;
  let fallbackCount = 0;
  const byProvider: Record<string, ProviderUsageSnapshot> = {};
  const byModel: Record<string, ProviderUsageSnapshot> = {};

  return {
    record(stats) {
      totalCalls += 1;
      totalInputTokens += stats.inputTokens ?? 0;
      totalOutputTokens += stats.outputTokens ?? 0;
      totalCachedTokens += stats.cachedTokens ?? 0;
      totalThinkingTokens += stats.thinkingTokens ?? 0;
      totalDurationMs += stats.durationMs;
      if (stats.fellBack) fallbackCount += 1;

      if (!byProvider[stats.provider]) byProvider[stats.provider] = emptyProviderSnapshot();
      addToBucket(byProvider[stats.provider], stats);

      if (!byModel[stats.model]) byModel[stats.model] = emptyProviderSnapshot();
      addToBucket(byModel[stats.model], stats);
    },
    snapshot() {
      return {
        totalCalls,
        totalInputTokens,
        totalOutputTokens,
        totalCachedTokens,
        totalThinkingTokens,
        totalDurationMs,
        fallbackCount,
        byProvider: structuredClone(byProvider),
        byModel: structuredClone(byModel),
      };
    },
    reset() {
      totalCalls = 0;
      totalInputTokens = 0;
      totalOutputTokens = 0;
      totalCachedTokens = 0;
      totalThinkingTokens = 0;
      totalDurationMs = 0;
      fallbackCount = 0;
      for (const key of Object.keys(byProvider)) delete byProvider[key];
      for (const key of Object.keys(byModel)) delete byModel[key];
    },
  };
}

export function formatUsageStats(stats: UsageStats): string {
  const parts: string[] = [];
  if (stats.inputTokens != null) parts.push(`${stats.inputTokens.toLocaleString()} input`);
  if (stats.outputTokens != null) parts.push(`${stats.outputTokens.toLocaleString()} output`);
  if (stats.thinkingTokens != null && stats.thinkingTokens > 0) {
    parts.push(`${stats.thinkingTokens.toLocaleString()} thinking`);
  }
  if (stats.cachedTokens != null && stats.cachedTokens > 0) {
    parts.push(`${stats.cachedTokens.toLocaleString()} cached`);
  }
  parts.push(`model: ${stats.model}`);
  if (stats.fellBack) parts.push("fell back");
  parts.push(`${stats.durationMs}ms`);
  return parts.length > 0 ? `\n\n[${stats.provider} stats: ${parts.join(", ")}]` : "";
}

export function formatSessionUsage(snapshot: SessionUsageSnapshot): string {
  if (snapshot.totalCalls === 0) return "No LLM calls recorded in this session yet.";

  const lines: string[] = [
    "## Session Usage Summary",
    "",
    `Total calls: ${snapshot.totalCalls.toLocaleString()}`,
    `Total input tokens: ${snapshot.totalInputTokens.toLocaleString()}`,
    `Total output tokens: ${snapshot.totalOutputTokens.toLocaleString()}`,
  ];
  if (snapshot.totalThinkingTokens > 0) {
    lines.push(`Total thinking tokens: ${snapshot.totalThinkingTokens.toLocaleString()}`);
  }
  if (snapshot.totalCachedTokens > 0) {
    lines.push(`Total cached tokens: ${snapshot.totalCachedTokens.toLocaleString()}`);
  }
  lines.push(`Total wall time: ${(snapshot.totalDurationMs / 1000).toFixed(1)}s`);
  if (snapshot.fallbackCount > 0) {
    lines.push(`Quota fallbacks triggered: ${snapshot.fallbackCount}`);
  }

  const providerEntries = Object.entries(snapshot.byProvider);
  if (providerEntries.length > 0) {
    lines.push("", "### By provider", "");
    for (const [provider, bucket] of providerEntries) {
      lines.push(
        `- **${provider}** — ${bucket.calls} calls, ` +
          `${bucket.inputTokens.toLocaleString()} in / ${bucket.outputTokens.toLocaleString()} out tokens, ` +
          `${(bucket.durationMs / 1000).toFixed(1)}s` +
          (bucket.fellBack > 0 ? `, ${bucket.fellBack} fallbacks` : ""),
      );
    }
  }

  return lines.join("\n");
}
