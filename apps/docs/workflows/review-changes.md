---
description: Ask another vendor’s model to check a diff, then validate its findings.
---

# Review changes

Start with a bounded diff and a specific review question:

```text
Ask Codex to review the staged changes for security issues, performance, and missing error handling.
```

Give the reviewer the change's purpose and constraints. Ask your assistant to include the diff and relevant surrounding code, then check each finding at the cited file and line. The reviewer reads; your assistant applies the changes you accept.

## Review workflow

The portable `ask-llm-review` workflow gathers staged and unstaged changes, reads project conventions, consults Codex and filters findings by confidence. Claude Code retains `/codex-review`; Pi uses `/skill:ask-llm-review`. Other hosts expose portable names through their skills menu. See [host compatibility](/compatibility/hosts).

For independent parallel review, use `ask-llm-multi-review`. The assistant validates candidate findings against source and separates supported findings, false positives and claims requiring runtime evidence. Antigravity is skipped unless its execution gate is explicitly enabled; that opt-in has no read-only guarantee. Partial results disclose failed providers.

## Keep the review useful

Use a narrow scope, include domain invariants, and request actionable issues rather than style preferences. Large diffs can take several minutes and consume substantial quota; split them by concern when possible. Agreement between models is not proof of correctness. Use tests for claims about runtime behavior.

For local analysis, ask Ollama to review the relevant code. For continuing feedback as you edit, see [pair review](/advanced/codex-pair), which is off until you opt in. The [workflow catalogue](/reference/skills) describes provider-specific variants.
