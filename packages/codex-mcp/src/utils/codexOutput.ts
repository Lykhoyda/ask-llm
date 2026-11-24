import { Ajv, type ValidateFunction } from "ajv";
import ajvFormats from "ajv-formats";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { z } from "zod";

type JsonValue = z.infer<ReturnType<typeof z.json>>;

export function compileOutputSchema(schema: Record<string, unknown>): ValidateFunction {
  const draft7 = "http://json-schema.org/draft-07/schema";
  const Validator = schema.$schema === draft7 || schema.$schema === `${draft7}#` ? Ajv : Ajv2020;
  try {
    // A call's schema and local references are private to that call.
    const validator = new Validator({ strictTypes: false, ownProperties: true });
    ajvFormats.default(validator);
    return validator.compile(schema);
  } catch (error) {
    throw new Error(
      `Invalid outputSchema. Supply a supported JSON Schema object or omit outputSchema. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function describeOutputSchemaRejection(error: unknown): string | undefined {
  if (!(error instanceof Error)) return;
  if (
    /invalid_json_schema|invalid schema|schema(?: file)? (?:is )?(?:invalid|not valid|rejected|unsupported)/i.test(
      error.message,
    )
  ) {
    return (
      `Codex rejected outputSchema: ${error.message}\n` +
      "Use a strict object schema. Set additionalProperties to false and include every property in required. " +
      "Use a nullable type for values that may be absent, or omit outputSchema for a plain-text reply."
    );
  }
}

export function validateOutput(
  validate: ValidateFunction,
  raw: string,
): { structuredResult: JsonValue; validationError?: never } | { validationError: string; structuredResult?: never } {
  try {
    const parsed: JsonValue = JSON.parse(raw, (_key, value: unknown) => {
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error("A number in the reply is outside the supported JSON number range.");
      }
      return value;
    });
    if (validate(parsed)) return { structuredResult: parsed };
    const issue = validate.errors?.[0];
    return {
      validationError: `Codex reply failed outputSchema validation at ${issue?.instancePath || "/"}: ${issue?.message}.`,
    };
  } catch (error) {
    return {
      validationError: `Could not parse or validate the Codex reply: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
