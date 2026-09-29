import type { HostOp } from "../apply.js";
import { SERVER_NAME } from "../registry.js";

export function codex(op: HostOp, server: string): string[] {
  return op === "add" ? ["codex", "mcp", "add", SERVER_NAME, "--", server] : ["codex", "mcp", "remove", SERVER_NAME];
}
