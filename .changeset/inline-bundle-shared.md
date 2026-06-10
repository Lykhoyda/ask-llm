---
"ask-gemini-mcp": patch
"ask-codex-mcp": patch
"ask-ollama-mcp": patch
"ask-antigravity-mcp": patch
"ask-llm-mcp": patch
---

Fix #115: `npm install -g` / `npx -y` on Node 26 crashed with `ERR_MODULE_NOT_FOUND` (npm 11 leaves empty placeholder dirs for bundled packages' transitive deps). `@ask-llm/shared` is now inlined into each package's `dist/` at build time (tsdown); `bundledDependencies` and the prepack/postpack manifest rewriting are gone entirely, so published manifests contain plain semver only.
