---
description: Install and sign in to the provider you want to consult; setup connects it to your host.
---

# Authentication

Ask LLM connects your host to the provider accounts you already use. Installing and signing in to a provider is your responsibility; setup never performs provider login.

| Provider or route | What must be ready |
|---|---|
| [Codex](/providers/codex) | Installed Codex CLI, authenticated account |
| [Claude](/providers/claude) | Installed Claude Code CLI, authenticated account; a host other than Claude Code |
| [Grok](/providers/grok) | Authenticated official Grok Build with headless JSON support, or an explicitly configured metered xAI API key |
| Cursor Agent | Authenticated Cursor CLI and exact model ID from `agent --list-models` |
| [Antigravity](/providers/antigravity) | Authenticated agy 1.1.5+ and explicit execution opt-in; opt-in has no read-only guarantee |
| [Ollama](/providers/ollama) | Running local server and the requested model pulled |
| [Gemini](/providers/gemini) | Authenticated CLI and an eligible Standard/Enterprise seat |

For subscription-backed routes, no separate model API key is needed. Grok's `xai-api` route requires `XAI_API_KEY` in the host's server environment and incurs metered charges. Pin `grok-cli` to use Grok Build rather than the default API route; routes never fail over to one another.

Provider credentials stay in the provider's login/configuration flow. The xAI API route reads the key from the process environment to authenticate requests; Ask LLM does not log or return it. Keep keys out of committed configuration.

Run `ask-llm doctor` to see what is installed and what authentication can be established without inference. An unknown auth state is not a successful login. Restart the host after adding a provider or changing its environment. See [diagnostics](/operation/diagnostics) for the optional quota-consuming live check.
