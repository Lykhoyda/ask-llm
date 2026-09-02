# @ask-llm/grok-mcp

## 0.1.3

### Patch Changes

- [#300](https://github.com/Lykhoyda/ask-llm/pull/300) [`a24889e`](https://github.com/Lykhoyda/ask-llm/commit/a24889e958af2962a0fc0e31cdd7d5ab042a5973) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Refresh the MCP SDK, validation libraries, Pi host SDK, and transitive runtime dependencies, including security-fixed Hono, URI, archive, HTTP, and parser releases.

## 0.1.2

### Patch Changes

- [#291](https://github.com/Lykhoyda/ask-llm/pull/291) [`d989ec9`](https://github.com/Lykhoyda/ask-llm/commit/d989ec916f71eefe5fe0814d5c1eb75d29dfe89f) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add a first-class Claude Code `/grok-pair` workflow with explicit Cursor Agent, xAI API, or Grok CLI routes and no silent fallback. Add Cursor Plugin/Agent Skills support for `/codex-pair` with consent, bounded context, exact Codex model/effort/include options, persisted session reuse, cancellation, and actionable diagnostics. Unified Ask LLM now forwards supported reasoning/include options, rejects `includeDirs` on resumed Codex threads instead of dropping them (enforced once in the shared Codex executor so the split `ask-codex` and Pi tools fail closed too), and Cursor Agent consultations support validated include directories plus structured session resume. The Claude plugin keeps bundling only Codex; `@ask-llm/mcp` and `@ask-llm/grok-mcp` are user-scoped installs for the Grok routes. Unified startup now detects authenticated Grok CLI-only installations without requiring an API key or server-wide harness override (an explicit `ASK_GROK_HARNESS` keeps readiness on that harness), while execution remains pinned to the request's explicit harness with no fallback and a CLI-only default-route call reports the `harness: "grok-cli"` pin instead of a bare missing-key error. The Cursor plugin manifest exposes exactly `/codex-pair` and `/grok-pair` with explicit empty `agents`/`commands`/`hooks`, and its `mcp.json` bundles only the unified `ask-llm` server (split Codex/Grok servers are optional user installs).

- [#290](https://github.com/Lykhoyda/ask-llm/pull/290) [`af77cd8`](https://github.com/Lykhoyda/ask-llm/commit/af77cd8b90cb836f87a39893d52e983a36fbea53) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Expose the provider/CLI-reported model separately as `reportedModel` on `GrokExecutorResult` and `GrokCliExecutorResult` (also round-tripped through the xAI response cache), leaving `model` as the effective ID. Consumers can now tell an independently observed served model apart from an echoed requested ID when the xAI payload or Grok CLI envelope omits `model`.

## 0.1.1

### Patch Changes

- [#279](https://github.com/Lykhoyda/ask-llm/pull/279) [`9d27169`](https://github.com/Lykhoyda/ask-llm/commit/9d27169fbe22c2ffbfae0be9d6cba841b98e42f1) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add first-class Grok consultations through explicit xAI API or official Grok CLI harnesses, with exact model selection, strict no-fallback diagnostics, redacted credentials, cancellation, telemetry, and opt-in live tests. Add a separate model-neutral Cursor Agent harness that requires provider and exact Cursor model attribution, runs read-only, and never changes trust or spend settings. The Cursor provider enum is `claude`, `codex`, `gemini`, `grok` in the unified server and Pi, and the requested model must belong to that family (Auto and noncanonical IDs are refused); `AskResponse` gains an optional `reportedModel` carrying Cursor's display label while `model` echoes the exact requested catalog ID. Prompts above 16 KB reach Grok CLI through a private `--prompt-file` (only when `grok --help` advertises it; otherwise they fail before spawn) and Cursor Agent over stdin. xAI effort coercion (`xhigh` applied as `high` on older models) and served-model alias resolution are disclosed, and an effort-rejecting 4xx is classified with the supported list.
