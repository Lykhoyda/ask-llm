import { type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import { askCodexArgsSchema, askCodexTool, executeCodexRequest } from "./ask-codex.tool.js";

export const askCodexWriteTool: UnifiedTool = {
  ...askCodexTool,
  name: "ask-codex-write",
  description:
    "Run Codex with workspace-write permission for explicit file-writing tasks, including image generation. May create, modify, or delete workspace files. For read-only reviews, analysis, and edit proposals use ask-codex or ask-codex-edit. Returns text and a structured response with model, sessionId, and usage.",
  zodSchema: askCodexArgsSchema.omit({ noFallback: true }).extend({
    sandbox: z.literal("workspace-write").optional().default("workspace-write"),
  }),
  annotations: {
    title: "Ask Codex (Write Files)",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  prompt: { description: "Run an explicit file-writing task with Codex CLI." },
  execute: (args, onProgress, onUsage, signal) =>
    executeCodexRequest(args, "workspace-write", onProgress, onUsage, signal),
};
