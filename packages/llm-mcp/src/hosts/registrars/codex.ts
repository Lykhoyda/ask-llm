import { EXECUTION } from "@ask-llm/shared";
import type { HostOp } from "../apply.js";
import { SERVER_NAME } from "../registry.js";

// Leave room for discovery, model-version probes and response serialization
// beyond the longest provider ladder. This is a host limit, in seconds.
export const CODEX_TOOL_TIMEOUT_MARGIN_SEC = 60;
export const CODEX_TOOL_TIMEOUT_SEC =
  Math.ceil(
    (Math.max(
      EXECUTION.DEFAULT_TIMEOUT_MS,
      EXECUTION.DEFAULT_CODEX_TIMEOUT_MS,
      EXECUTION.DEFAULT_CLAUDE_TIMEOUT_MS,
      EXECUTION.DEFAULT_GROK_TIMEOUT_MS,
      EXECUTION.DEFAULT_CURSOR_TIMEOUT_MS,
      EXECUTION.DEFAULT_OLLAMA_TIMEOUT_MS,
    ) *
      EXECUTION.MAX_PROVIDER_ATTEMPTS) /
      1000,
  ) + CODEX_TOOL_TIMEOUT_MARGIN_SEC;

export function codexTimeoutGuidance(file: string): string {
  return [
    `In ${file}, merge this setting into the existing server table (do not append a duplicate table):`,
    `[mcp_servers.${SERVER_NAME}]`,
    `tool_timeout_sec = ${CODEX_TOOL_TIMEOUT_SEC}`,
    `If environment variables raise per-attempt limits, raise tool_timeout_sec to at least ceil(largest configured per-attempt limit in ms * ${EXECUTION.MAX_PROVIDER_ATTEMPTS} / 1000) + ${CODEX_TOOL_TIMEOUT_MARGIN_SEC}.`,
  ].join("\n");
}

export function codex(op: HostOp, server: string, name = SERVER_NAME): string[] {
  return op === "add" ? ["codex", "mcp", "add", name, "--", server] : ["codex", "mcp", "remove", name];
}
