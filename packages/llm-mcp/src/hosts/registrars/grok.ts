import type { HostOp } from "../apply.js";
import { SERVER_NAME } from "../registry.js";

export function grok(op: HostOp, server: string): string[] {
  return op === "add"
    ? ["grok", "mcp", "add", "--scope", "user", SERVER_NAME, server]
    : ["grok", "mcp", "remove", "--scope", "user", SERVER_NAME];
}
