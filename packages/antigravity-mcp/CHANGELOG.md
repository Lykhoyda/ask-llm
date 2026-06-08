# ask-antigravity-mcp

## 0.1.0

### Minor Changes

- [#157](https://github.com/Lykhoyda/ask-llm/pull/157) [`51305da`](https://github.com/Lykhoyda/ask-llm/commit/51305da38d3d5a8e606d8cd9bc94c9634a23fdd2) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Publish the experimental `ask-antigravity-mcp` provider for Google's Antigravity CLI (`agy`). Validated end-to-end against a real `agy` 1.0.6 (which prints to stdout — gemini-cli [#27466](https://github.com/Lykhoyda/ask-llm/issues/27466) is fixed there; transcript-file reading is the fallback). `ask-llm-mcp` now bundles `ask-antigravity-mcp` so the unified orchestrator can load it when `agy` is installed.
