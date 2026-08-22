# Portable pair-programming contract

This contract is shared by `/codex-pair` on Cursor Agent and `/grok-pair` on Claude Code. Host adapters may use different registration and lifecycle APIs, but must preserve these guarantees.

## Roles and lifecycle

The host remains the only editor. The consulted model is an explicit, read-only reviewer that challenges correctness, tests assumptions, and returns actionable findings. Run one state machine:

`idle -> consented -> active -> completed | cancelled | failed`

Before `active`, resolve and show the user the provider, harness, exact requested model, reasoning effort, directories/files to be shared, credential/cost boundary, and whether a resumable provider session will be created. If the host cannot read the provider process's configured model and effort deterministically, require the user to supply both rather than inferring defaults that may differ across environments. Missing choices stop before extra context reads, consent, or provider invocation. Refusal returns `cancelled` without creating a marker, reading extra directories, or invoking a provider.

During `active`, relay each reviewer response before acting on it, verify findings against source, state accepted/rejected/deferred actions, and send only the bounded delta needed for the next checkpoint. The user or host interrupt cancels the in-flight MCP call; do not retry it under another tool, harness, model, or provider. End with one explicit `completed`, `cancelled`, or `failed` report.

## Bounded context and include directories

Default bounds are 20 KB per file and 100 KB per provider request. Prefer diffs, task requirements, project instructions, relevant tests, and narrow excerpts over whole repositories. Never send secrets, credential files, unrelated untracked files, or ignored paths.

Additional directories must be explicit relative workspace paths: no absolute paths, `..`, or `~`; at most 32. Pass `includeDirs` only to a tool that supports it. If a selected route cannot expose extra directories, say so and ask whether to inline bounded excerpts or continue without them. Never silently drop a requested directory.

## Transport, options, and attribution

Select one route before the first call and keep it immutable for the run. Resolve tools by their exact leaf capability (`ask-codex`, `ask-grok`, or `ask-cursor-agent`), not by assuming a Claude plugin namespace. The unified `ask-llm` tool is an acceptable transport only when the call pins provider, harness where applicable, exact model, reasoning effort, include directories, and session explicitly and its schema rejects unsupported combinations rather than stripping them; it is never an unpinned generic call and never a fallback for a failed split tool. A missing tool is a setup failure, never permission to use a generic call.

Every call and final report must keep these separate:

- host harness;
- provider;
- execution harness/transport;
- exact requested model ID;
- provider-native reasoning effort (or, for Cursor catalogs, the exact effort-bearing model ID);
- optional upstream display label (`reportedModel`).

Never choose Cursor Auto, rewrite a model ID, suppress a requested option, or claim fallback when none occurred. Any cross-provider reported label is terminal.

## Sessions, partial failure, and diagnostics

Create and reuse a provider session only when the selected tool returns a session ID. Capture the ID from structured output, never scrape prose. On resumed Codex calls, omit `includeDirs` because `codex exec resume` does not support them; the initial call must establish that context. One-shot transports receive bounded deltas and are reported as one-shot.

Preserve successful feedback if a later checkpoint fails, label the run `failed (partial)`, and report the failed checkpoint. Distinguish tool missing, provider unavailable, authentication, model unavailable, quota/spend, trust, timeout, cancellation, malformed output, and cross-provider substitution. Include exact setup guidance for the selected route and explicitly say that no fallback was attempted.
