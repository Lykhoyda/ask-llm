---
description: Get a second opinion on a small diff from another vendor’s model.
---

# First review

Before your first review, both your coding assistant (for example Claude Code) and the provider you will consult (for example Codex) must be installed and signed in. Ask LLM configures the connection; it does not install providers or sign you in. If a provider CLI such as Codex has never been signed in on this machine, sign in first and rerun `ask-llm setup`.

Open a project with a small staged change. With both Claude Code and Codex signed in, ask in Claude Code:

```text
Ask Codex to review my staged changes for bugs and missing error handling. Check each finding against the source before proposing fixes.
```

If Codex is your host, ask Claude instead. You can name any [provider](/start/install#before-you-start) you have authenticated; choose a different vendor from the model writing the code.

A successful response identifies the reviewer and model and cites code supporting its findings, or says it found none. Your assistant stays responsible for editing. Review the evidence and decide which fixes to apply; agreement between models is not proof of correctness.

If you get a missing-tool or authentication error, run `ask-llm doctor` in your terminal, follow its remediation for your selected assistant and reviewer, and restart the host. Warnings about providers you do not use do not require installing them or adding API keys. [Troubleshooting](/resources/troubleshooting) covers common failures. Registration alone does not prove a provider can answer.

Next, [review a larger change](/workflows/review-changes) or [challenge a plan](/workflows/challenge-plan).
