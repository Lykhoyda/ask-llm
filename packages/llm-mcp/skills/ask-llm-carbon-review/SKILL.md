---
name: ask-llm-carbon-review
description: Review the current code changes or a plan specifically with Google Gemini 4 Carbon (High) through Antigravity. Use when the user asks for a Carbon review, says "review with Carbon", wants an Antigravity review pinned to gemini-4-carbon-high, or invokes /carbon-review.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Gather a bounded diff (or the plan under review) and context brief, request a read-only Antigravity review explicitly pinned to `gemini-4-carbon-high` with `noFallback: true`, verify findings against source, and disclose any model or transport fallback. The model ID already carries the High effort tier, so omit `reasoningEffort`: Ask LLM rejects a separate effort with a tiered ID. Do not silently substitute another provider, model, or tool.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Native `ask-antigravity` has no `model` or `noFallback`, so call native `ask-llm` with `provider: "antigravity"`, `model: "gemini-4-carbon-high"`, `noFallback: true`, and no `reasoningEffort`. Apply the portable contract above and report the model the response names.

### Other hosts adapter

Codex, Cursor Agent, Antigravity, Grok Build, Gemini CLI and OpenCode get this skill from their skills folder, not from a plugin. Apply the portable contract above inline with the Antigravity call from `../ask-llm-review/transport.md`. `ask-antigravity` has no `model`, so call the `ask-llm` tool with `provider: "antigravity"`, `model: "gemini-4-carbon-high"`, and `noFallback: true`. If its input schema lacks `model` or `noFallback`, stop and say this Ask LLM server is too old for the workflow and `npm install -g @ask-llm/mcp` updates it. Report the transport used and disclose any model the response names other than `gemini-4-carbon-high`.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Carbon Code Review

Run a read-only, precision-first review explicitly pinned to Gemini 4 Carbon (High) through Google's Antigravity CLI (`agy`).

## Prerequisites

This skill is **experimental** and has the same requirements as `/antigravity-review`:

- A supported `agy` version signed in to the intended Google account. Confirm the account's credit settings before the first Antigravity call.
- The Ask LLM server registered (`npm install -g @ask-llm/mcp`, then `ask-llm setup`), with `ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1` set for it. Opted-in runs have no read-only guarantee; Ask LLM sends agy a read-only preamble and a session-only overlay that denies file writes and commands.

Google does not support third-party headless use on consumer plans and describes third-party access as a terms violation. Review Google's position before choosing this route. [Ask LLM Antigravity guide](https://lykhoyda.github.io/ask-llm/providers/antigravity)

## Workflow

1. Run `git status --short`, `git diff`, and `git diff --cached`. When the user names a plan or spec file instead of code changes, review that file.
2. Include untracked files the user wants reviewed with `git add -N <path>` so their contents appear in the diff without staging them.
3. If the combined diff is empty and no plan was named, report that there is nothing to review.
4. Read the root and file-scoped `CLAUDE.md` files plus any ADRs cited by changed code.
5. Search the current tool surface for the `ask-llm` leaf of the `ask-llm` server (Claude Code shows `mcp__ask-llm__ask-llm`) and read its input schema. It must offer `antigravity` as a `provider` and advertise `model` and `noFallback`. If no such leaf is exposed, stop and tell the user to run `ask-llm setup`. If a field is missing, stop and say this Ask LLM server is too old for the workflow and `npm install -g @ask-llm/mcp` updates it; never call it with fewer fields. An `ask-antigravity` leaf cannot take the model pin, so do not use it. There is no CLI fallback.
6. Launch the `carbon-reviewer` agent with the diff or plan, the resolved tool name, and a compact context brief containing the changed files, applicable conventions, referenced ADRs, and the user's requested review focus.
7. Return the agent's validated findings without adding unverified issues.

The reviewer must call the unified tool with `provider: "antigravity"`, `model: "gemini-4-carbon-high"`, `noFallback: true`, and no `reasoningEffort`. With `noFallback: true` Ask LLM makes one attempt: no rate-limit fallback to another model and no model-less recovery. If agy rejects the model, the call is rate limited, or `ASK_ANTIGRAVITY_EFFORT` makes agy reject the tiered ID, report the error and stop. `/antigravity-review` follows the configured Antigravity default instead. If the response names a model other than `gemini-4-carbon-high`, disclose that the review did not run as pinned. Backend model identity is unverified.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
