---
description: Provider defaults, route selection, timeouts and execution gates.
---

# Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| XAI_API_KEY | required for xai-api | xAI credential; never logged/returned |
| ASK_GROK_HARNESS | xai-api | Explicit xai-api or grok-cli selection; no failover |
| ASK_GROK_MODEL | grok-4.7 | Exact selected-harness Grok model ID |
| ASK_GROK_REASONING_EFFORT | high | low, medium, high, or xhigh |
| ASK_GROK_MAX_OUTPUT_TOKENS | 16384 | xAI API output cap to bound accidental spend |
| ASK_GROK_TIMEOUT_MS | 600000 | Grok API/CLI timeout |
| CURSOR_API_KEY | optional | Cursor CLI credential alternative to agent login |
| ASK_CURSOR_TIMEOUT_MS | 600000 | Model-neutral Cursor Agent harness timeout |
| ASK_GEMINI_MODEL | gemini-3.1-pro-preview | Override the Gemini default model |
| ASK_GEMINI_FALLBACK_MODEL | gemini-3.8-flash | Override the Gemini quota fallback model |
| ASK_CODEX_MODEL | gpt-6-astra | Override the Codex default model |
| ASK_CODEX_PREFERRED_MODEL | gpt-6-astra | Legacy review-tier escape hatch; only attempted separately when it differs from ASK_CODEX_MODEL |
| ASK_CODEX_FALLBACK_MODEL | gpt-6.1-terra | Override the Codex quota fallback model |
| ASK_CODEX_REASONING_EFFORT | medium | Default Codex reasoning effort; per-call reasoningEffort wins |
| ASK_CLAUDE_MODEL | opus | Override the Claude default model |
| ASK_CLAUDE_FALLBACK_MODEL | sonnet | Override Claude Code's native fallback model |
| ASK_OLLAMA_MODEL | qwen3.8:27b | Override the Ollama model (no fallback) |
| ASK_ANTIGRAVITY_MODEL | gemini-3.1-pro | Override the Antigravity base model slug |
| ASK_ANTIGRAVITY_EFFORT | high | Override Antigravity reasoning effort (`low`, `medium`, or `high`) |
| ASK_GEMINI_TIMEOUT_MS | 210000 (210s) | Gemini process timeout |
| ASK_CODEX_TIMEOUT_MS | 800000 (800s) | Codex process timeout |
| ASK_CLAUDE_TIMEOUT_MS | 600000 (600s) | Claude process timeout |
| ASK_OLLAMA_TIMEOUT_MS | 600000 (600s) | Ollama request timeout |
| ASK_ANTIGRAVITY_TIMEOUT_MS | 300000 (300s) | Antigravity process timeout |
| GMCPT_TIMEOUT_MS | (per-provider default) | Cross-provider timeout fallback (lower precedence than ASK_*_TIMEOUT_MS) |
| GMCPT_LOG_LEVEL | warn | Log level: debug, info, warn, error |
| OLLAMA_HOST | `http://localhost:11434` | Ollama server address |

### Safety / behavior switches

| Variable | Default | Description |
|----------|---------|-------------|
| ASK_CODEX_LOAD_USER_CONFIG | unset (isolated) | By default @ask-llm/codex-mcp passes `--ignore-user-config` + `--ignore-rules` so your `~/.codex` config, MCP servers, and hooks are NOT loaded. Set to `1` to load them. |
| ASK_GEMINI_REQUIRE_WORKSPACE_TRUST | unset (auto-trust) | By default @ask-llm/gemini-mcp co-emits the workspace-trust env vars so the CWD is trusted. Set to `1` to require explicit workspace trust instead (Gemini blocks untrusted dirs). |
| ASK_ANTIGRAVITY_ALLOW_UNISOLATED | unset (refused) | See the [provider guide](https://lykhoyda.github.io/ask-llm/providers/antigravity) for the execution gate, including `/brainstorm`. |
| ASK_ANTIGRAVITY_SANDBOX | 1 (sandboxed) | Antigravity runs `agy` with `--sandbox` by default. Set to `0` to drop the sandbox flag. |

Environment values must reach the server process, not just an unrelated terminal. Restart your host after changing its server environment. Never commit literal credentials. Model defaults are also listed under [Costs and fallbacks](/operation/costs).
