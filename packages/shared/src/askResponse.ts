import { z } from "zod";
import { PROVIDERS } from "./providers.js";

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

export const harnessSchema = z.enum(["xai-api", "grok-cli", "cursor-agent"]);

export const askResponseSchema = z.object({
  provider: z.enum(PROVIDERS),
  response: z.string(),
  model: z.string(),
  sessionId: z.string().optional(),
  reasoningEffort: z.string().optional(),
  usage: usageStatsSchema.optional(),
  harness: harnessSchema.optional(),
  reportedModel: z.string().optional(),
});

export type AskResponse = z.infer<typeof askResponseSchema>;

export function formatCodexSelection(
  attempt: { model: string; reasoningEffort: string; cached: boolean },
  fellBack = false,
): string {
  const status = attempt.cached ? " · cached" : fellBack ? " · fallback" : "";
  return `Codex CLI · selected ${attempt.model} · reasoning effort configured ${attempt.reasoningEffort}${status}`;
}
