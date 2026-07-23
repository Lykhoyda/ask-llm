import type { UsageStats } from "@ask-llm/shared";
import { describe, expect, it, vi } from "vitest";
import type { ExecutorFn } from "../index.js";
import { buildMultiLlmInputSchema, dispatchMultiLlm, formatMultiLlmReport, multiLlmReportSchema } from "../multiLlm.js";

function makeUsage(overrides: Partial<UsageStats> = {}): UsageStats {
  return {
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    inputTokens: 100,
    outputTokens: 50,
    cachedTokens: 0,
    thinkingTokens: 0,
    durationMs: 500,
    fellBack: false,
    ...overrides,
  };
}

function executor(response: string, sessionId?: string, usage?: UsageStats): ExecutorFn {
  return vi.fn().mockResolvedValue({ response, sessionId, usage });
}

describe("dispatchMultiLlm", () => {
  it("dispatches to all providers in parallel and collects results", async () => {
    const exGemini = executor("gemini ans", undefined, makeUsage({ provider: "gemini" }));
    const exCodex = executor("codex ans", "thread-123", makeUsage({ provider: "codex", model: "gpt-5.4" }));

    const report = await dispatchMultiLlm({
      prompt: "what is 2+2",
      providers: ["gemini", "codex"],
      getExecutor: (p) => (p === "gemini" ? exGemini : p === "codex" ? exCodex : undefined),
    });

    expect(report.successCount).toBe(2);
    expect(report.failureCount).toBe(0);
    expect(report.results).toHaveLength(2);
    expect(report.results.find((r) => r.provider === "gemini")?.response).toBe("gemini ans");
    expect(report.results.find((r) => r.provider === "codex")?.response).toBe("codex ans");
    expect(report.results.find((r) => r.provider === "codex")?.sessionId).toBe("thread-123");
  });

  it("records usage stats via the recordUsage callback for each successful call", async () => {
    const recorded: UsageStats[] = [];
    const exGemini = executor("a", undefined, makeUsage({ provider: "gemini", inputTokens: 100 }));
    const exCodex = executor("b", undefined, makeUsage({ provider: "codex", inputTokens: 200 }));

    await dispatchMultiLlm({
      prompt: "p",
      providers: ["gemini", "codex"],
      getExecutor: (p) => (p === "gemini" ? exGemini : exCodex),
      recordUsage: (stats) => recorded.push(stats),
    });

    expect(recorded).toHaveLength(2);
    expect(recorded.map((r) => r.inputTokens).sort()).toEqual([100, 200]);
  });

  it("returns ok=false with error message when an executor throws", async () => {
    const exGemini = executor("ok response");
    const exCodex: ExecutorFn = vi.fn().mockRejectedValue(new Error("quota exceeded"));

    const report = await dispatchMultiLlm({
      prompt: "p",
      providers: ["gemini", "codex"],
      getExecutor: (p) => (p === "gemini" ? exGemini : exCodex),
    });

    expect(report.successCount).toBe(1);
    expect(report.failureCount).toBe(1);
    expect(report.results.find((r) => r.provider === "codex")?.ok).toBe(false);
    expect(report.results.find((r) => r.provider === "codex")?.error).toContain("quota exceeded");
    expect(report.results.find((r) => r.provider === "gemini")?.ok).toBe(true);
  });

  it("returns ok=false with 'not loaded' error when a requested provider has no executor", async () => {
    const exGemini = executor("ok");

    const report = await dispatchMultiLlm({
      prompt: "p",
      providers: ["gemini", "phantom"],
      getExecutor: (p) => (p === "gemini" ? exGemini : undefined),
    });

    expect(report.successCount).toBe(1);
    expect(report.failureCount).toBe(1);
    expect(report.results.find((r) => r.provider === "phantom")?.error).toContain("not loaded");
  });

  it("reports a provider's top-level result.model when usage is absent (Antigravity fallback)", async () => {
    // Antigravity surfaces the actual model out-of-band (no usage stats); after a
    // Pro → Flash rate-limit fallback the result carries model: Flash, which must
    // be reported rather than dropped to undefined.
    const exAntigravity: ExecutorFn = vi.fn().mockResolvedValue({ response: "ans", model: "Gemini 3.5 Flash (High)" });
    const report = await dispatchMultiLlm({
      prompt: "p",
      providers: ["antigravity"],
      getExecutor: () => exAntigravity,
    });
    expect(report.results[0].model).toBe("Gemini 3.5 Flash (High)");
  });

  it("prefers usage.model over a top-level result.model when both are present", async () => {
    const ex: ExecutorFn = vi
      .fn()
      .mockResolvedValue({ response: "ans", model: "top-level", usage: makeUsage({ model: "usage-model" }) });
    const report = await dispatchMultiLlm({
      prompt: "p",
      providers: ["gemini"],
      getExecutor: () => ex,
    });
    expect(report.results[0].model).toBe("usage-model");
  });

  it("treats prefers result.threadId over result.sessionId when both are absent then present", async () => {
    const ex: ExecutorFn = vi.fn().mockResolvedValue({ response: "x", threadId: "T-42" });
    const report = await dispatchMultiLlm({
      prompt: "p",
      providers: ["codex"],
      getExecutor: () => ex,
    });
    expect(report.results[0].sessionId).toBe("T-42");
  });

  it("populates dispatchedAt as ISO timestamp and totalDurationMs as a number", async () => {
    const ex = executor("ok");
    const report = await dispatchMultiLlm({
      prompt: "p",
      providers: ["gemini"],
      getExecutor: () => ex,
    });
    expect(report.dispatchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(typeof report.totalDurationMs).toBe("number");
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("dispatches in parallel (total time ≈ slowest, not sum)", async () => {
    const slow: ExecutorFn = vi
      .fn()
      .mockImplementation(() => new Promise((r) => setTimeout(() => r({ response: "slow" }), 60)));
    const fast: ExecutorFn = vi
      .fn()
      .mockImplementation(() => new Promise((r) => setTimeout(() => r({ response: "fast" }), 10)));

    const start = Date.now();
    await dispatchMultiLlm({
      prompt: "p",
      providers: ["gemini", "codex"],
      getExecutor: (p) => (p === "gemini" ? slow : fast),
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(120);
  });

  it("the report shape conforms to multiLlmReportSchema", async () => {
    const ex = executor("ok", undefined, makeUsage());
    const report = await dispatchMultiLlm({
      prompt: "p",
      providers: ["gemini"],
      getExecutor: () => ex,
    });
    expect(multiLlmReportSchema.safeParse(report).success).toBe(true);
  });

  it("accepts antigravity usage stats in the report schema", () => {
    const report = {
      dispatchedAt: "2026-07-02T00:00:00.000Z",
      totalDurationMs: 10,
      successCount: 1,
      failureCount: 0,
      results: [
        {
          provider: "antigravity",
          ok: true,
          response: "hi",
          model: "Gemini 3.1 Pro (High)",
          usage: {
            provider: "antigravity",
            model: "Gemini 3.1 Pro (High)",
            durationMs: 10,
            fellBack: false,
          },
          durationMs: 10,
        },
      ],
    };
    expect(multiLlmReportSchema.safeParse(report).success).toBe(true);
  });
});

describe("formatMultiLlmReport", () => {
  it("renders a markdown header with success ratio and total duration", () => {
    const text = formatMultiLlmReport({
      dispatchedAt: "2026-04-17T00:00:00.000Z",
      totalDurationMs: 1500,
      successCount: 2,
      failureCount: 1,
      results: [
        { provider: "gemini", ok: true, response: "ok", model: "g", durationMs: 500 },
        { provider: "codex", ok: true, response: "ok", model: "c", durationMs: 500 },
        { provider: "ollama", ok: false, error: "down", durationMs: 100 },
      ],
    });
    expect(text).toContain("2/3 succeeded");
    expect(text).toContain("1.5s total");
  });

  it("renders successful providers with check glyph and response", () => {
    const text = formatMultiLlmReport({
      dispatchedAt: "2026-04-17T00:00:00.000Z",
      totalDurationMs: 500,
      successCount: 1,
      failureCount: 0,
      results: [
        {
          provider: "gemini",
          ok: true,
          response: "the answer is 4",
          model: "gemini-3.1-pro-preview",
          durationMs: 500,
        },
      ],
    });
    expect(text).toContain("### gemini ✓");
    expect(text).toContain("gemini-3.1-pro-preview");
    expect(text).toContain("the answer is 4");
  });

  it("renders failed providers with x glyph and error message", () => {
    const text = formatMultiLlmReport({
      dispatchedAt: "2026-04-17T00:00:00.000Z",
      totalDurationMs: 100,
      successCount: 0,
      failureCount: 1,
      results: [{ provider: "codex", ok: false, error: "quota exceeded", durationMs: 100 }],
    });
    expect(text).toContain("### codex ✗");
    expect(text).toContain("**Failed:** quota exceeded");
  });
});

describe("buildMultiLlmInputSchema", () => {
  it("accepts only providers in the available list when supplied", () => {
    const schema = buildMultiLlmInputSchema(["gemini", "codex"]);
    expect(schema.safeParse({ prompt: "p", providers: ["gemini"] }).success).toBe(true);
    expect(schema.safeParse({ prompt: "p", providers: ["ollama"] }).success).toBe(false);
  });

  it("makes providers optional", () => {
    const schema = buildMultiLlmInputSchema(["gemini"]);
    expect(schema.safeParse({ prompt: "p" }).success).toBe(true);
  });

  it("rejects empty prompt", () => {
    const schema = buildMultiLlmInputSchema(["gemini"]);
    expect(schema.safeParse({ prompt: "", providers: ["gemini"] }).success).toBe(false);
  });

  it("falls back to all canonical providers when availableProviders is empty", () => {
    const schema = buildMultiLlmInputSchema([]);
    expect(schema.safeParse({ prompt: "p", providers: ["ollama"] }).success).toBe(true);
    expect(schema.safeParse({ prompt: "p", providers: ["claude"] }).success).toBe(true);
  });

  it("excludes detected but unusable providers from the fallback provider list", () => {
    const schema = buildMultiLlmInputSchema([], ["antigravity"]);
    expect(schema.safeParse({ prompt: "p", providers: ["codex"] }).success).toBe(true);
    expect(schema.safeParse({ prompt: "p", providers: ["antigravity"] }).success).toBe(false);
  });
});
