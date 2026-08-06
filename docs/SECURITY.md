# Security Policy

## Supported versions

Only the latest minor version of each published package receives security fixes. Update with:

```bash
npm install -g @ask-llm/gemini-mcp@latest @ask-llm/codex-mcp@latest @ask-llm/claude-mcp@latest @ask-llm/ollama-mcp@latest @ask-llm/antigravity-mcp@latest @ask-llm/mcp@latest
```

For the Claude Code plugin, run `/plugin update ask-llm` from inside Claude Code. For the same canonical package on Pi, run `pi update npm:@ask-llm/plugin`.

## Reporting a vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Use [GitHub Private Vulnerability Reporting](https://github.com/Lykhoyda/ask-llm/security/advisories/new) to report privately. We aim to respond within 7 days.

Include in your report:
- Affected package and version (`@ask-llm/gemini-mcp`, `@ask-llm/codex-mcp`, `@ask-llm/claude-mcp`, `@ask-llm/ollama-mcp`, `@ask-llm/antigravity-mcp`, `@ask-llm/mcp`, or `@ask-llm/plugin`)
- A clear description of the issue
- Reproduction steps or proof-of-concept if possible
- Your suggested mitigation if you have one
- Whether you'd like credit in the advisory

## Threat model

The MCP server runs locally as a subprocess of the user's MCP client (Claude Code, Claude Desktop, Cursor, etc.) with the user's privileges. The `@ask-llm/plugin` Pi extension likewise runs with the installing user's full permissions; Pi project trust is an input-loading guard, not a sandbox. Provider CLIs (`gemini`, `codex`, `claude`, `agy`) and Ollama are trusted dependencies.

Pi codex-pair defaults off and requires a repository marker, Pi project trust, and a user-owned allowlist keyed by canonical project root. A committed marker alone never authorizes source transfer or cost. Consent is revocable with `/codex-pair revoke`; external provider paths can transmit bounded project context, while Ollama remains local. Review and second-opinion Codex paths run with `--sandbox read-only` (ADR-136). Antigravity has no hard file-tool read-only mode: Ask LLM adds its read-only preamble and `--sandbox` to every managed path, but this remains a soft boundary and is documented as such in `docs/BUGS.md`.

Claude consultations run with `--safe-mode` and an explicit `Read,Glob,Grep` tool list. Bash, Edit, Write, user-configured MCP servers, hooks, and plugins are unavailable to the nested reviewer. The provider refuses to run when `CLAUDECODE` indicates Claude Code is already the host.

### In scope

- Command injection via tool arguments (prompt, model, includeDirs, sessionId)
- Path traversal via `@file` syntax or `--include-directories`
- Information disclosure — secrets leaking into logs, error responses, or stderr that is propagated back to the MCP client
- Plugin hooks executing untrusted shell content (PostToolUse, SessionStart/SessionEnd, UserPromptSubmit, and the opt-in Stop gate in `packages/claude-plugin/hooks/hooks.json`)
- Workspace-protocol bundling bugs that could cause unintended code to be installed at `npm install` time (see ADR-052)
- Temp file handling — leakage of staged diffs or session content from `/tmp/ask-llm-*` files
- Insecure defaults in the `commandExecutor` spawn options or the resolved `PATH` (ADR-047)

### Out of scope

- Vulnerabilities in upstream provider CLIs — report to Google (Gemini/Antigravity), OpenAI (Codex), Anthropic (Claude), or Ollama directly
- Vulnerabilities in `@modelcontextprotocol/sdk` — report to the MCP project
- Issues that already require local code execution as the same user the MCP server runs as (the MCP server is not a privilege boundary — it already runs with your full user privileges)
- Vulnerabilities in the user's MCP client (Claude Code, Claude Desktop, etc.)
- Quality-of-output issues with LLM responses (prompt injection from a file the user explicitly asked to read is a usage concern, not a vulnerability in this project)

## Disclosure timeline

| Day | Action |
|-----|--------|
| 0   | Report received via GitHub Private Vulnerability Reporting |
| ≤ 7 | Initial response with severity assessment |
| ≤ 30 | Fix developed, advisory drafted |
| ≤ 90 | Coordinated disclosure and patch release (or earlier if a fix is ready and the issue is being actively exploited) |

## Acknowledgments

Reporters who follow coordinated disclosure are credited in the published GitHub Security Advisory unless they request anonymity.

