import type { HostOp } from "../apply.js";
import type { JsonEdit } from "../json-merge.js";
import { SERVER_NAME } from "../registry.js";

export function opencode(op: HostOp, server: string): JsonEdit {
  return {
    keyPath: ["mcp", SERVER_NAME],
    value: op === "add" ? { type: "local", command: [server], enabled: true } : undefined,
  };
}
