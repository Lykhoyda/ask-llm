import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodTypeAny } from "zod";
import { ZodError } from "zod";
import type { BaseToolArguments } from "./constants.js";
import type { ProviderName } from "./providers.js";
import type { UsageStats } from "./usage.js";

export interface StructuredToolResult {
  text: string;
  structuredContent: Record<string, unknown>;
}

export type ToolResult = string | StructuredToolResult;

export interface UnifiedTool {
  name: string;
  description: string;
  zodSchema: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  annotations?: ToolAnnotations;

  prompt?: {
    description: string;
    arguments?: Array<{
      name: string;
      description: string;
      required: boolean;
    }>;
  };

  execute: (
    args: BaseToolArguments,
    onProgress?: (newOutput: string) => void,
    onUsage?: (stats: UsageStats) => void,
  ) => Promise<ToolResult>;
  category?: "simple" | ProviderName | "utility";
}

export const toolRegistry: UnifiedTool[] = [];

export async function executeTool(
  toolName: string,
  args: BaseToolArguments,
  onProgress?: (newOutput: string) => void,
  onUsage?: (stats: UsageStats) => void,
): Promise<ToolResult> {
  const tool = toolRegistry.find((t) => t.name === toolName);
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  try {
    const validatedArgs = tool.zodSchema.parse(args) as BaseToolArguments;
    return tool.execute(validatedArgs, onProgress, onUsage);
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
      throw new Error(`Invalid arguments for ${toolName}: ${issues}`);
    }
    throw error;
  }
}

export function getPromptMessage(toolName: string, args: Record<string, string>): string {
  const tool = toolRegistry.find((t) => t.name === toolName);
  if (!tool?.prompt) {
    throw new Error(`No prompt defined for tool: ${toolName}`);
  }
  const paramStrings: string[] = [];

  if (args.prompt) {
    paramStrings.push(args.prompt);
  }

  Object.entries(args).forEach(([key, value]) => {
    if (key !== "prompt" && value !== undefined && value !== null && value !== "false") {
      if (value === "true") {
        paramStrings.push(`[${key}]`);
      } else {
        paramStrings.push(`(${key}: ${value})`);
      }
    }
  });

  return `Use the ${toolName} tool${paramStrings.length > 0 ? `: ${paramStrings.join(" ")}` : ""}`;
}
