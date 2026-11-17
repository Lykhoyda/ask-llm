import type { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Logger } from "./logger.js";

/** One server instance per connection, serving either MCP protocol form. */
export function serveMcpStdio(buildServer: () => McpServer | Promise<McpServer>) {
  return serveStdio(buildServer, { onerror: (error) => Logger.error("MCP stdio error:", error) });
}
