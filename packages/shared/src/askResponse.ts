import { z } from "zod";

const usageStatsSchema = z.object({
  provider: z.enum(["gemini", "codex", "ollama", "antigravity"]),
  model: z.string(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedTokens: z.number().optional(),
  thinkingTokens: z.number().optional(),
  durationMs: z.number(),
  fellBack: z.boolean(),
});

export const askResponseSchema = z.object({
  provider: z.enum(["gemini", "codex", "ollama", "antigravity"]),
  response: z.string(),
  model: z.string(),
  sessionId: z.string().optional(),
  usage: usageStatsSchema.optional(),
});

export type AskResponse = z.infer<typeof askResponseSchema>;
