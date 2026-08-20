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
  usage: usageStatsSchema.optional(),
  harness: harnessSchema.optional(),
});

export type AskResponse = z.infer<typeof askResponseSchema>;
