---
description: Gemini CLI sandbox mode, what it is, how to use it, and why it's no longer exposed as an MCP tool parameter.
---

# Sandbox Mode

Gemini CLI ships a sandboxed code-execution environment that lets the model write and run code in an isolated context. This is a **Gemini CLI feature**, not a feature of the MCP server.

::: tip Gemini-only, and Gemini is now enterprise-gated
Sandbox mode is specific to the Gemini CLI. Since Gemini CLI is [enterprise-gated as of 2026-06-18](/providers/gemini), this feature is available only to eligible Gemini Code Assist Standard/Enterprise seats.
:::

## Why isn't there a `sandbox` parameter on `ask-gemini` anymore?

The `ask-gemini` MCP tool schema was simplified from 8 parameters to 2 (`prompt` + `model`) for token efficiency and to reduce LLM-induced parameter hallucinations. The `sandbox` parameter was one of the casualties; it's a niche feature that most users don't need, and exposing it added noise to every Claude/Codex/Cursor instance loading the tool definition.

The underlying executor still supports sandbox mode programmatically; only the MCP-facing schema dropped it.

## How to use sandbox mode today

If you need Gemini's sandbox, run `gemini` directly from your terminal with the `-s` flag:

```bash
gemini -s -p "Write a Python script that sorts a list and run it"
```

Inside Claude Code, you can dispatch this via Bash:

```text
Run this in bash: gemini -s -p "Write and execute a Python script that validates this JSON: ..."
```

The plugin's `ask-gemini-run` binary (a small node wrapper) also passes through to the executor; you can adapt it if you want a programmatic path.

## When you'd actually want sandbox mode

- Testing snippets the model just generated (write + execute in one round-trip)
- Quick proof-of-concepts where you want runtime evidence, not just code
- Learning: see code execute with real output

For most workflows (review, analysis, refactor suggestions), sandbox is unnecessary and the simpler `ask-gemini` / `ask-llm` MCP tools are the right call.

## Limitations

Sandbox capabilities depend on your Gemini CLI version and Gemini account. See the [Gemini CLI documentation](https://github.com/google-gemini/gemini-cli) for current sandbox features and constraints.
