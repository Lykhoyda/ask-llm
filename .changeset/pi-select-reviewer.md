---
"@ask-llm/mcp": minor
---

Pi can use Codex or Claude for advisory reviews of settled edits. Choose `reviewer: claude` for pinned Claude Opus 5.5 or keep the Codex default. Before consent, Pi discloses the selected CLI, model, use of that CLI's configured account, bounded context and quota. Changing reviewer requires a new grant for that project. Legacy grants authorize Codex only.

Pi recognizes settings in the initial fenced frontmatter. Plain markers use defaults. Codex model, effort and quota fallback, provider timeouts, debounce and file limits now follow the shared configuration policy. A Codex quota failure may try one distinct configured Codex fallback. Claude has no fallback, and reviews never switch providers. The next eligible edit of a previously reviewed file may receive one cold review after upgrading.
