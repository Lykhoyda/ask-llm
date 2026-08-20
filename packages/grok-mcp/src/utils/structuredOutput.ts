export type JsonSchema = Record<string, unknown>;

function schemaConstraint(schema: JsonSchema): string {
  return `Return only one JSON object matching this JSON Schema: ${JSON.stringify(schema)}`;
}

export function constrainPromptToSchema(prompt: string, schema: JsonSchema): string {
  const constraint = schemaConstraint(schema);
  if (prompt.trimEnd().endsWith(constraint)) return prompt;
  return `${prompt}\n\n${constraint}`;
}
