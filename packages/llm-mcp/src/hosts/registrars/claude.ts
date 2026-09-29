import type { HostOp } from "../apply.js";
import { SERVER_NAME } from "../registry.js";

export function claude(op: HostOp, server: string): string[] {
  return op === "add"
    ? ["claude", "mcp", "add", "--scope", "user", SERVER_NAME, "--", server]
    : ["claude", "mcp", "remove", "--scope", "user", SERVER_NAME];
}
