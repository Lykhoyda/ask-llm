import type { HostOp } from "../apply.js";
import { SERVER_NAME } from "../registry.js";

// `agy mcp add` overwrites in place; callers must recheck absence or migration ownership before adding.
export function antigravity(op: HostOp, server: string, name = SERVER_NAME): string[] {
  return op === "add" ? ["agy", "mcp", "add", name, server] : ["agy", "mcp", "remove", name];
}
