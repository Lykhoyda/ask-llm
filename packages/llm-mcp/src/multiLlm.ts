import { PROVIDERS, type UsageStats } from "@ask-llm/shared";
import { z } from "zod";
import type { ExecutorFn } from "./index.js";

export interface MultiLlmResult {
  provider: string;
  ok: boolean;
  response?: string;
  model?: string;
  sessionId?: string;
  usage?: UsageStats;
  durationMs: number;
  error?: string;
}

export interface MultiLlmReport {
  dispatchedAt: string;
  totalDurationMs: number;
  successCount: number;
  failureCount: number;
  results: MultiLlmResult[];
}

const usageStatsSchema = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedTokens: z.number().optional(),
  thinkingTokens: z.number().optional(),
  durationMs: z.number(),
  fellBack: z.boolean(),
});

const multiLlmResultSchema = z.object({
  provider: z.string(),
  ok: z.boolean(),
  response: z.string().optional(),
  model: z.string().optional(),
  sessionId: z.string().optional(),
  usage: usageStatsSchema.optional(),
  durationMs: z.number(),
  error: z.string().optional(),
});

export const multiLlmReportSchema = z.object({
  dispatchedAt: z.string(),
  totalDurationMs: z.number(),
  successCount: z.number(),
  failureCount: z.number(),
  results: z.array(multiLlmResultSchema),
});

export interface DispatchOptions {
  prompt: string;
  providers: string[];
  getExecutor: (provider: string) => ExecutorFn | undefined;
  recordUsage?: (stats: UsageStats) => void;
}

export async function dispatchMultiLlm(opts: DispatchOptions): Promise<MultiLlmReport> {
  const dispatchedAt = new Date().toISOString();
  const startTime = Date.now();

  const dispatches = opts.providers.map(async (provider): Promise<MultiLlmResult> => {
    const callStart = Date.now();
    const executor = opts.getExecutor(provider);
    if (!executor) {
      return {
        provider,
        ok: false,
        error: `Provider "${provider}" is not loaded`,
        durationMs: Date.now() - callStart,
      };
    }
    try {
      const result = await executor({ prompt: opts.prompt });
      if (result.usage) opts.recordUsage?.(result.usage);
      return {
        provider,
        ok: true,
        response: result.response,
        model: result.usage?.model ?? result.model,
        sessionId: result.sessionId ?? result.threadId,
        usage: result.usage,
        durationMs: Date.now() - callStart,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        provider,
        ok: false,
        error: msg,
        durationMs: Date.now() - callStart,
      };
    }
  });

  const results = await Promise.all(dispatches);
  const totalDurationMs = Date.now() - startTime;
  const successCount = results.filter((r) => r.ok).length;
  const failureCount = results.length - successCount;

  return { dispatchedAt, totalDurationMs, successCount, failureCount, results };
}

export function formatMultiLlmReport(report: MultiLlmReport): string {
  const header = `## Multi-LLM Dispatch — ${report.successCount}/${report.results.length} succeeded (${(report.totalDurationMs / 1000).toFixed(1)}s total)\n`;
  const sections = report.results.map((r) => {
    const status = r.ok ? "✓" : "✗";
    const durationTag = `${(r.durationMs / 1000).toFixed(1)}s`;
    const modelTag = r.model ? ` · ${r.model}` : "";
    if (r.ok) {
      return `\n### ${r.provider} ${status} (${durationTag}${modelTag})\n\n${r.response ?? "(empty response)"}`;
    }
    return `\n### ${r.provider} ${status} (${durationTag})\n\n**Failed:** ${r.error ?? "unknown error"}`;
  });
  return [header, ...sections].join("\n");
}

export function buildMultiLlmInputSchema(
  availableProviders: string[],
  excludedProviders: string[] = [],
): z.ZodObject<z.ZodRawShape> {
  const excluded = new Set(excludedProviders);
  const providerEnum =
    availableProviders.length > 0 ? availableProviders : [...PROVIDERS].filter((provider) => !excluded.has(provider));
  return z.object({
    prompt: z.string().min(1).max(100000).describe("The prompt to send to all selected providers in parallel."),
    providers: z
      .array(z.enum(providerEnum as [string, ...string[]]))
      .min(1)
      .optional()
      .describe(
        `Which providers to dispatch to. Available: ${providerEnum.join(", ")}. Defaults to all available providers.`,
      ),
  });
}
