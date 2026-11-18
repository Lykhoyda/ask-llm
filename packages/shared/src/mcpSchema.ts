import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z } from "zod";

/** Preserve the published draft-07 tool schemas while SDK 2 validates through Standard Schema. */
export function mcpSchema<T extends z.ZodType>(schema: T): StandardSchemaWithJSON<z.input<T>, z.output<T>> {
  return {
    "~standard": {
      ...schema["~standard"],
      jsonSchema: {
        input: () => z.toJSONSchema(schema, { target: "draft-7", io: "input" }),
        output: () => z.toJSONSchema(schema, { target: "draft-7", io: "output" }),
      },
    },
  };
}
