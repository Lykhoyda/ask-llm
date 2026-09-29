import type { HostOp } from "../apply.js";
import { SERVER_NAME } from "../registry.js";

// `agy mcp add` updates an existing entry in place, so setup must only call it when the plan says register.
export function antigravity(op: HostOp, server: string): string[] {
  return op === "add" ? ["agy", "mcp", "add", SERVER_NAME, server] : ["agy", "mcp", "remove", SERVER_NAME];
}
