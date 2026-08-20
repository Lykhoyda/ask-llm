export type JsonSchema = Record<string, unknown>;

export function constrainPromptToSchema(prompt: string, schema: JsonSchema): string {
  return `${prompt}\n\nReturn only one JSON object matching this JSON Schema: ${JSON.stringify(schema)}`;
}
