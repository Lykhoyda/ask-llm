---
"@ask-llm/mcp": patch
---

Make the root CLI treat no arguments as the only implicit MCP server-start path. Help and version now print without provider detection, while unsupported commands and arguments fail with clear usage instead of silently starting the server.
