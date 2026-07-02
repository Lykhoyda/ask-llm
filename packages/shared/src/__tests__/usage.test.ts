import { describe, expect, it } from "vitest";
import { createSessionUsage, formatSessionUsage, formatUsageStats, type UsageStats } from "../usage.js";

function makeStats(overrides: Partial<UsageStats> = {}): UsageStats {
  return {
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    inputTokens: 100,
    outputTokens: 200,
    cachedTokens: 0,
    thinkingTokens: 0,
    durationMs: 1500,
    fellBack: false,
    ...overrides,
  };
}

describe("createSessionUsage", () => {
  it("starts with an empty snapshot", () => {
    const session = createSessionUsage();
    const snap = session.snapshot();
    expect(snap.totalCalls).toBe(0);
    expect(snap.totalInputTokens).toBe(0);
    expect(snap.byProvider).toEqual({});
  });

  it("aggregates totals across calls", () => {
    const session = createSessionUsage();
    session.record(makeStats({ inputTokens: 100, outputTokens: 200, durationMs: 1000 }));
    session.record(makeStats({ inputTokens: 50, outputTokens: 75, durationMs: 500 }));

    const snap = session.snapshot();
    expect(snap.totalCalls).toBe(2);
    expect(snap.totalInputTokens).toBe(150);
    expect(snap.totalOutputTokens).toBe(275);
    expect(snap.totalDurationMs).toBe(1500);
  });

  it("records antigravity usage under its own provider bucket", () => {
    const session = createSessionUsage();
    session.record(makeStats({ provider: "antigravity", model: "Gemini 3.1 Pro (High)", inputTokens: 42 }));

    const snap = session.snapshot();
    expect(snap.byProvider.antigravity.calls).toBe(1);
    expect(snap.byProvider.antigravity.inputTokens).toBe(42);
  });

  it("groups by provider and model independently", () => {
    const session = createSessionUsage();
    session.record(makeStats({ provider: "gemini", model: "gemini-3.1-pro-preview", inputTokens: 100 }));
    session.record(makeStats({ provider: "codex", model: "gpt-5.4", inputTokens: 200 }));
    session.record(makeStats({ provider: "gemini", model: "gemini-3-flash-preview", inputTokens: 50, fellBack: true }));

    const snap = session.snapshot();
    expect(snap.byProvider.gemini.calls).toBe(2);
    expect(snap.byProvider.gemini.inputTokens).toBe(150);
    expect(snap.byProvider.gemini.fellBack).toBe(1);
    expect(snap.byProvider.codex.calls).toBe(1);
    expect(Object.keys(snap.byModel)).toHaveLength(3);
  });

  it("treats nullish token counts as zero in totals", () => {
    const session = createSessionUsage();
    session.record(makeStats({ inputTokens: undefined, outputTokens: 100 }));
    const snap = session.snapshot();
    expect(snap.totalInputTokens).toBe(0);
    expect(snap.totalOutputTokens).toBe(100);
  });

  it("counts fallbacks separately from total calls", () => {
    const session = createSessionUsage();
    session.record(makeStats({ fellBack: false }));
    session.record(makeStats({ fellBack: true }));
    session.record(makeStats({ fellBack: true }));

    expect(session.snapshot().fallbackCount).toBe(2);
    expect(session.snapshot().totalCalls).toBe(3);
  });

  it("snapshot returns a deep copy that does not mutate on further records", () => {
    const session = createSessionUsage();
    session.record(makeStats({ inputTokens: 100 }));
    const snap = session.snapshot();
    session.record(makeStats({ inputTokens: 999 }));
    expect(snap.byProvider.gemini.inputTokens).toBe(100);
  });

  it("reset clears all accumulators", () => {
    const session = createSessionUsage();
    session.record(makeStats());
    session.record(makeStats({ provider: "codex" }));
    session.reset();

    const snap = session.snapshot();
    expect(snap.totalCalls).toBe(0);
    expect(snap.byProvider).toEqual({});
    expect(snap.byModel).toEqual({});
  });
});

describe("formatUsageStats", () => {
  it("includes input, output, model, and duration by default", () => {
    const out = formatUsageStats(makeStats({ inputTokens: 1234, outputTokens: 5678, durationMs: 1500 }));
    expect(out).toContain("1,234 input");
    expect(out).toContain("5,678 output");
    expect(out).toContain("model: gemini-3.1-pro-preview");
    expect(out).toContain("1500ms");
    expect(out.startsWith("\n\n[gemini stats:")).toBe(true);
  });

  it("omits cached and thinking when zero", () => {
    const out = formatUsageStats(makeStats({ cachedTokens: 0, thinkingTokens: 0 }));
    expect(out).not.toContain("cached");
    expect(out).not.toContain("thinking");
  });

  it("includes thinking and cached when present", () => {
    const out = formatUsageStats(makeStats({ thinkingTokens: 800, cachedTokens: 100 }));
    expect(out).toContain("800 thinking");
    expect(out).toContain("100 cached");
  });

  it("notes when a fallback model was used", () => {
    const out = formatUsageStats(makeStats({ fellBack: true }));
    expect(out).toContain("fell back");
  });
});

describe("formatSessionUsage", () => {
  it("returns an empty-state message when no calls recorded", () => {
    const session = createSessionUsage();
    expect(formatSessionUsage(session.snapshot())).toBe("No LLM calls recorded in this session yet.");
  });

  it("renders totals and per-provider breakdown", () => {
    const session = createSessionUsage();
    session.record(makeStats({ provider: "gemini", inputTokens: 100, outputTokens: 200, durationMs: 1500 }));
    session.record(
      makeStats({ provider: "codex", model: "gpt-5.4", inputTokens: 50, outputTokens: 75, durationMs: 800 }),
    );

    const out = formatSessionUsage(session.snapshot());
    expect(out).toContain("Total calls: 2");
    expect(out).toContain("Total input tokens: 150");
    expect(out).toContain("By provider");
    expect(out).toContain("**gemini**");
    expect(out).toContain("**codex**");
  });

  it("includes fallback count only when nonzero", () => {
    const session = createSessionUsage();
    session.record(makeStats({ fellBack: false }));
    expect(formatSessionUsage(session.snapshot())).not.toContain("fallbacks triggered");

    session.record(makeStats({ fellBack: true }));
    expect(formatSessionUsage(session.snapshot())).toContain("Quota fallbacks triggered: 1");
  });
});
