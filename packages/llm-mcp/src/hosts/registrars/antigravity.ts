import type { HostOp } from "../apply.js";
import { SERVER_NAME } from "../registry.js";

// `agy mcp add` updates an existing entry in place, so setup must only call it when the plan says register.
export function antigravity(op: HostOp, server: string, name = SERVER_NAME): string[] {
  return op === "add" ? ["agy", "mcp", "add", name, server] : ["agy", "mcp", "remove", name];
}
