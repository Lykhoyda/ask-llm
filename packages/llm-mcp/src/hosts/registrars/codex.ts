import type { HostOp } from "../apply.js";
import { SERVER_NAME } from "../registry.js";

export function codex(op: HostOp, server: string, name = SERVER_NAME): string[] {
  return op === "add" ? ["codex", "mcp", "add", name, "--", server] : ["codex", "mcp", "remove", name];
}
