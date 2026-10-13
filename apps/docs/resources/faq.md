---
description: Accounts, host compatibility, cost, privacy and second-opinion workflows.
---

# Frequently asked questions

## What is Ask LLM?

Second opinions for coding agents. Get a second opinion on your code or plan, inside your coding assistant, using the model subscriptions you already have. It is for individual developers and small teams who already use a coding assistant and another model account.

## Do I need every provider?

No. Install and sign in to the provider you want to consult; Ask LLM configures its connection to your host. You need Node.js 24+ on Linux or macOS. Start at [Install](/start/install).

## Which package should I choose?

There is one install line on [Install](/start/install). Earlier installations have a [migration guide](/reference/migration), rather than a separate onboarding path.

## What does a review cost?

Calls consume the selected account's quota or billing. Subscription-backed routes need no separate model API key. Grok's xAI API is an explicit metered option requiring a key; Grok Build and Cursor follow their plans. Ollama uses local compute. See [Costs and fallbacks](/operation/costs).

## Can Codex ask Claude?

Yes. Claude is available from Codex and other hosts. It is suppressed inside Claude Code because nested Claude sessions are unsupported. Claude consultations use Read, Glob and Grep; your host applies changes.

## Does model agreement prove correctness?

No. Validate claims against source, tests and requirements. [Compare answers](/workflows/compare-answers) preserves raw responses, while [review workflows](/workflows/review-changes) check candidate findings against source.

## Which hosts work?

See [Hosts](/compatibility/hosts). Claude Desktop is tools only. Pi uses native tools and needs no MCP config. Antigravity has a manual workflow-copy step. Existing Codex registrations need inspection; OpenCode registration is verified with fixtures only.

## Why is Gemini restricted?

The provider requires an eligible Code Assist Standard/Enterprise seat. See [Enterprise environments / Gemini](/advanced/enterprise-gemini) and the unchanged [provider reference](/providers/gemini). Ask LLM cannot grant provider eligibility.

## Where does my code go?

To the provider you select, under its policies. Local Ollama inference stays on your local endpoint. Ask LLM sends no telemetry. Host conversations, provider sessions and opt-in pairing state have separate storage; see [Data flow](/operation/data-flow).

## How do follow-up questions work?

Claude, Gemini, Codex and Ollama support sessions. Codex needs `sessionId: ""` on the first call to persist a resumable thread; omitted Codex calls are ephemeral. Grok and Antigravity are single-turn. Follow-ups still consume account quota or billing; see [Tools and schemas](/reference/tools#sessions).

## What is Gemini's @ file syntax?

The Gemini CLI interprets `@file.ts`, `@src/` and globs as file context. Other providers need relevant code in the prompt or their supported include-directory mechanism. Ask your assistant to bound the context.

## What should I check when a call fails?

Run `ask-llm doctor`. It distinguishes installation, registration, authentication, permission and optional live exercise. Healthy registration alone does not prove a provider call succeeds. See [Troubleshooting](/resources/troubleshooting).

## Can I use Ask LLM in automation?

The product is designed for interactive review. The [CLI reference](/reference/cli) documents the existing machine protocol and scripting flags. Check account eligibility and data policy before automating provider calls.

## More questions

- [Documentation](/)
- [GitHub Issues](https://github.com/Lykhoyda/ask-llm/issues)
- [GitHub Discussions](https://github.com/Lykhoyda/ask-llm/discussions)
