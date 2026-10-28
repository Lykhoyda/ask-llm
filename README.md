# Ask LLM

**Second opinions for coding agents.**

Get a second opinion on your code or plan, inside your coding assistant, using the model subscriptions you already have.

For individual developers and small teams who already use a coding assistant and pay for another model subscription: ask a different vendor's model to **review your changes** or **challenge your plan**, without API keys, copy-paste, or leaving the session.

```text
You:    ask codex to review src/auth.ts for security issues
Codex:  ⚠ verifyToken() compares tokens with === — not timing-safe (line 42)
        ⚠ the session cookie is missing a SameSite attribute
Claude: Good catches — applying both fixes to src/auth.ts.
```

## Install

You need Node.js 24+ on Linux or macOS. Before your first review, both your coding assistant (for example Claude Code) and the provider you will consult (for example Codex) must be installed and signed in. Ask LLM configures the connection; it does not install providers or sign you in. If a provider CLI such as Codex has never been signed in on this machine, sign in first and rerun setup.

```bash
npm i -g @ask-llm/mcp && ask-llm setup
```

Setup asks you to confirm each detected host and workflow. Inspect the preview, confirm your assistant's registration and workflows, decline the others, then follow any printed manual steps. Restart your assistant or start a new session in your project.

## Your first review

With both Claude Code and Codex installed and signed in, open Claude Code in your project and ask:

```text
Ask Codex to review my staged changes for bugs and missing error handling. Check each finding against the source before proposing fixes.
```

Working in Codex with a Claude subscription? Ask Claude instead. Choose a provider from a different vendor than your current assistant. A successful review names the reviewer and model, cites relevant code, and reports findings or says it found none. Your assistant applies changes after you decide what to accept. If the request fails, run `ask-llm doctor` and follow the [troubleshooting guide](https://lykhoyda.github.io/ask-llm/resources/troubleshooting) for your selected assistant and reviewer. Warnings about providers you do not use do not require installing them or adding API keys.

For plans, try: “Ask Claude to challenge this plan: what assumptions could fail, and what simpler approach would fit our constraints?”

After an on-demand review, [pair review](https://lykhoyda.github.io/ask-llm/advanced/codex-pair) can add ongoing feedback. Pairing requires explicit opt-in; setup leaves it off. Grok CLI supports a [per-edit hook](https://lykhoyda.github.io/ask-llm/advanced/codex-pair#grok-cli) with Codex Sol by default or Claude Opus 5.5 via `reviewer: claude`; shell reviews cover command text only.

## Supported hosts

A host is the assistant you work in; a provider is the model you consult.

| Host | Experience |
|---|---|
| Claude Code | Reviews, plan critique, comparisons; isolated reviewers and opt-in per-edit pairing |
| Codex, Cursor, Grok Build, Gemini CLI | Tools and portable workflows; pairing on demand |
| Antigravity | Tools; setup prints a manual step for workflows |
| Pi 0.83.0+ | Native tools and portable workflows; opt-in per-edit pairing |
| Claude Desktop | Tools only |
| OpenCode | Tools and portable workflows; setup verified with fixtures only |

See [host compatibility](https://lykhoyda.github.io/ask-llm/compatibility/hosts) for the complete matrix and manual setup limits, including existing Codex registrations.

## Supported providers

| Provider | Access |
|---|---|
| [Codex](https://lykhoyda.github.io/ask-llm/providers/codex) | Your authenticated Codex CLI/account |
| [Claude](https://lykhoyda.github.io/ask-llm/providers/claude) | Your authenticated Claude Code account; consult it from a host other than Claude Code |
| [Grok](https://lykhoyda.github.io/ask-llm/providers/grok) | Authenticated Grok Build, an exact Cursor model, or the explicit metered xAI API option |
| [Antigravity](https://lykhoyda.github.io/ask-llm/providers/antigravity) | Your authenticated agy subscription; execution is off by default, and opt-in has no read-only guarantee |
| [Ollama](https://lykhoyda.github.io/ask-llm/providers/ollama) | Local models on your machine |
| [Gemini](https://lykhoyda.github.io/ask-llm/providers/gemini) | An eligible Gemini Code Assist Standard/Enterprise seat |

Cursor Agent can also consult exact models from your Cursor catalog. It is a connection route, with usage governed by your Cursor plan.

## Trust and cost

Review runs use read-only provider controls; the assistant you work in remains the editor. Antigravity refuses execution until explicitly enabled and cannot guarantee read-only access after opt-in. Review only material you are allowed to share with the selected provider.

Calls consume your existing provider plan's quota or follow that account's billing. Grok's xAI API is a separate, metered option requiring an API key; Ask LLM never enables billing or overage for you. Ollama supports local inference. Ask LLM sends no telemetry; provider and host data policies still apply.

Agreement between models is not proof of correctness. Validate findings against the code, tests, and your requirements. See [data flow](https://lykhoyda.github.io/ask-llm/operation/data-flow) and [costs and fallbacks](https://lykhoyda.github.io/ask-llm/operation/costs).

## Migrating from @ask-llm/*

Follow the [migration guide](https://lykhoyda.github.io/ask-llm/reference/migration.html) before retiring earlier registrations.

[Upgrade or remove](https://lykhoyda.github.io/ask-llm/start/upgrade-remove) · [Troubleshooting](https://lykhoyda.github.io/ask-llm/resources/troubleshooting) · [Documentation](https://lykhoyda.github.io/ask-llm/)

Contributions: [CONTRIBUTING.md](docs/CONTRIBUTING.md). Licensed under [MIT](LICENSE).
