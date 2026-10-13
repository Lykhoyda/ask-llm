---
description: See independent answers side by side without merging them into a vote.
---

# Compare answers

Use the same bounded context for every reviewer:

```text
Ask Codex and Claude to review this API design. Show their raw answers side by side, without synthesis.
```

Use providers your host can consult; Claude is unavailable inside Claude Code. The `ask-llm-compare` workflow returns verbatim answers with attribution. Claude Code retains `/compare`; Pi uses `/skill:ask-llm-compare`. Tool-only hosts can ask their assistant to call `multi-llm` with the selected providers.

<FanOut />

One provider failure does not erase the others' answers. Keep failures visible and attribute surviving insights only to providers that answered. Compare evidence and disagreements, not vote counts: agreement between models is not proof of correctness.

For a report that checks findings against the code, use [Review changes](/workflows/review-changes). For research and synthesis, use [Brainstorm](/workflows/brainstorm).
