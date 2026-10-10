import type { HostOp } from "../apply.js";
import type { JsonEdit } from "../json-merge.js";
import { SERVER_NAME } from "../registry.js";

// `agy mcp add` rewrites the whole file and drops other servers' empty `args`, so setup edits only this key.
export function antigravity(op: HostOp, server: string): JsonEdit {
  return { keyPath: ["mcpServers", SERVER_NAME], value: op === "add" ? { command: server, args: [] } : undefined };
}
