import type { HostOp } from "../apply.js";
import { SERVER_NAME } from "../registry.js";

export function claude(op: HostOp, server: string, name = SERVER_NAME): string[] {
  return op === "add"
    ? ["claude", "mcp", "add", "--scope", "user", name, "--", server]
    : ["claude", "mcp", "remove", "--scope", "user", name];
}
