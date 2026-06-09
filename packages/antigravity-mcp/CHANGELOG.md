# ask-antigravity-mcp

## 0.2.1

### Patch Changes

- Updated dependencies [[`2f12b43`](https://github.com/Lykhoyda/ask-llm/commit/2f12b43c5b8111e3f726ee52fc237ca31df0b4b0)]:
  - @ask-llm/shared@0.3.4

## 0.2.0

### Minor Changes

- [#167](https://github.com/Lykhoyda/ask-llm/pull/167) [`0e14e19`](https://github.com/Lykhoyda/ask-llm/commit/0e14e19fd55dad04c4cc31b55336a970de01ef0b) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add model selection to `ask-antigravity`, defaulting to **Gemini 3.5 Flash (High)**. Antigravity's `agy` supports model choice via the long `--model` flag (the short `-m` flag hangs under `-p`, which is why v1 shipped without it). Override with the `ASK_ANTIGRAVITY_MODEL` env var (run `agy models` for the list) or per-call via the executor's `model` option. The structured `AskResponse.model` now reports the actual model used instead of the `"antigravity"` placeholder.

## 0.1.0

### Minor Changes

- [#157](https://github.com/Lykhoyda/ask-llm/pull/157) [`51305da`](https://github.com/Lykhoyda/ask-llm/commit/51305da38d3d5a8e606d8cd9bc94c9634a23fdd2) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Publish the experimental `ask-antigravity-mcp` provider for Google's Antigravity CLI (`agy`). Validated end-to-end against a real `agy` 1.0.6 (which prints to stdout — gemini-cli [#27466](https://github.com/Lykhoyda/ask-llm/issues/27466) is fixed there; transcript-file reading is the fallback). `ask-llm-mcp` now bundles `ask-antigravity-mcp` so the unified orchestrator can load it when `agy` is installed.
