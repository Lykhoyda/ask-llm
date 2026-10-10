import type { HostOp } from "../apply.js";
import { SERVER_NAME } from "../registry.js";

export function grok(op: HostOp, server: string, name = SERVER_NAME): string[] {
  return op === "add"
    ? ["grok", "mcp", "add", "--scope", "user", name, server]
    : ["grok", "mcp", "remove", "--scope", "user", name];
}
