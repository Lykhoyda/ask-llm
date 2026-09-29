import type { HostOp } from "../apply.js";
import type { JsonEdit } from "../json-merge.js";
import { SERVER_NAME } from "../registry.js";

export function cursor(op: HostOp, server: string): JsonEdit {
  return { keyPath: ["mcpServers", SERVER_NAME], value: op === "add" ? { command: server, args: [] } : undefined };
}
