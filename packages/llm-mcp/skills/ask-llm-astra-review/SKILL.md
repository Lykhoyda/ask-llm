---
name: ask-llm-astra-review
description: Review the current code changes or a plan specifically with OpenAI GPT-6 Astra. Use when the user asks for an Astra review, says "review with Astra", wants a flagship-pinned Codex review, or invokes /astra-review.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Gather a bounded diff (or the plan under review) and context brief, request a read-only Codex review explicitly pinned to `gpt-6-astra` with `reasoningEffort: "high"`, verify findings against source, and disclose any model or transport fallback. Do not silently substitute another provider.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Call `ask-codex` with `model: "gpt-6-astra"`, `reasoningEffort: "high"`, and `sandbox: "read-only"`; apply the portable contract above and disclose fallback metadata.

### Other hosts adapter

Codex, Cursor Agent, Antigravity, Grok Build, Gemini CLI and OpenCode get this skill from their skills folder, not from a plugin. Apply the portable contract above inline, with the Codex call from `../ask-llm-review/transport.md`: `model: "gpt-6-astra"`, `reasoningEffort: "high"`, `sandbox: "read-only"`. Disclose a Terra quota fallback and any transport fallback.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Astra Code Review

Run a read-only, precision-first review explicitly pinned to GPT-6 Astra at high reasoning effort.

## Workflow

1. Run `git status --short`, `git diff`, and `git diff --cached`. When the user names a plan or spec file instead of code changes, review that file.
2. Include untracked files the user wants reviewed with `git add -N <path>` so their contents appear in the diff without staging them.
3. If the combined diff is empty and no plan was named, report that there is nothing to review.
4. Read the root and file-scoped `CLAUDE.md` files plus any ADRs cited by changed code.
5. Search the current tool surface for an exact `ask-codex` leaf first, then an `ask-llm` leaf, and capture the unified tool's advertised input schema. Then preflight the transport exactly as `/sol-review` does, adding `--model gpt-6-astra` to the shipped executable: `node "${CLAUDE_PLUGIN_ROOT}/scripts/sol-review-transport.mjs" --model gpt-6-astra --plugin-dir "${CLAUDE_PLUGIN_ROOT}" --cli-path "$(command -v codex || true)"`, with `--tool "<resolved tool name>"` (and `--tool-schema` for unified `ask-llm`) when an exact `ask-codex` or `ask-llm` tool resolved. Mirror session-local `--mcp-config`, `--settings`, `--setting-sources`, and `--strict-mcp-config` flags. Preserve the returned `state`, `diagnostic`, `remediation`, and `fallbackDisclosure`; if `transport` is null, stop and show the remediation instead of launching the agent.
6. Launch the `astra-reviewer` agent with the diff or plan and a compact context brief containing the changed files, applicable conventions, referenced ADRs, the user's requested review focus, and the complete preflight result.
7. Return the agent's validated findings without adding unverified issues.

The reviewer must call `ask-codex` with `model: "gpt-6-astra"`, `reasoningEffort: "high"`, and `sandbox: "read-only"`, or the unified `ask-llm` equivalent with `provider: "codex"` and those same fields, or use the shipped CLI fallback runner with `--model gpt-6-astra` when no usable MCP tool is available. That runner executes `codex exec -m gpt-6-astra -c model_reasoning_effort="high" -s read-only --ignore-user-config --ignore-rules --skip-git-repo-check` and relays its result unchanged. `gpt-6-astra` requires Codex CLI 0.153.0 or later: the MCP path fails an older CLI with an upgrade diagnostic, and the CLI runner relays Codex's own rejection unchanged; neither switches models. This explicit pin distinguishes `/astra-review` from `/codex-review`, which follows the configured Codex default, and from `/sol-review`, which pins `gpt-6.1-sol`. Disclose both fallback kinds: a Terra quota fallback means the requested Astra review did not complete on Astra, and a CLI transport fallback must report the preflight state without guessing.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
