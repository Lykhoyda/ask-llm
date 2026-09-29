import type { HostOp } from "../apply.js";
import { SERVER_NAME } from "../registry.js";

// Both `gemini mcp add` and `remove` default to project scope; Ask LLM is registered per user.
export function gemini(op: HostOp, server: string): string[] {
  return op === "add"
    ? ["gemini", "mcp", "add", "--scope", "user", SERVER_NAME, server]
    : ["gemini", "mcp", "remove", "--scope", "user", SERVER_NAME];
}
