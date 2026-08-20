import { EXECUTION } from "@ask-llm/shared";
import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

export function constrainPromptToSchema(prompt: string, schema: JsonSchema): string {
  return `${prompt}\n\nReturn only one JSON object matching this JSON Schema: ${JSON.stringify(schema)}`;
}

function jsonCandidates(content: string): string[] {
  const trimmed = content.trim();
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));
  return [...new Set(candidates)];
}

function schemaValidator(schema: JsonSchema, harnessLabel: string): z.ZodType {
  try {
    return z.fromJSONSchema(schema);
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, EXECUTION.ERROR_TRUNCATE_LENGTH);
    throw new Error(
      `${harnessLabel} structured output cannot be validated locally because the requested JSON Schema is unsupported: ${detail}. Simplify the schema. No fallback was attempted.`,
    );
  }
}

export function validateStructuredOutput(content: string, schema: JsonSchema, harnessLabel: string): string {
  const validator = schemaValidator(schema, harnessLabel);
  let lastIssue = "no JSON object was found in the output";
  for (const candidate of jsonCandidates(content)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const result = validator.safeParse(parsed);
    if (result.success) return candidate;
    lastIssue = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ")
      .slice(0, EXECUTION.ERROR_TRUNCATE_LENGTH);
  }
  throw new Error(
    `${harnessLabel} output did not match the requested JSON Schema (${lastIssue}). Retry with a simpler prompt or schema. No fallback was attempted.`,
  );
}
