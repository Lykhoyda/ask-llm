---
description: Consent to an exact Grok route for iterative review; there is no automatic failover.
---

# Grok pair

Claude Code's `/grok-pair` selects one immutable Grok route: `cursor-agent` (preferred when configured with an exact Grok-family ID from `agent --list-models`), `xai-api`, or `grok-cli`. Before provider work it shows provider, harness, exact model, reasoning semantics, bounded files/include directories, session support, and cost boundary for consent. Claude remains the editor; Grok feedback is relayed and verified at each checkpoint. Cancellation, partial failure, and final attribution are explicit; Auto, model rewriting, and provider/harness fallback are forbidden.

```text
/grok-pair route=cursor-agent model=grok-4.7-high include=packages/api review this change
/grok-pair route=xai-api model=grok-4.7 effort=xhigh review this change
```

On Claude Code, setup registers the connection for Cursor and direct Grok tools; the Claude adapter itself bundles only Codex. The unified `ask-llm` tool is used only with provider, harness, exact model, and effort pinned. When Cursor itself hosts `/grok-pair`, it avoids recursive Cursor invocation and offers only explicit API/CLI routes through `ask-grok` or that fully pinned unified form; missing tools produce `.cursor/mcp.json` plus Cursor Tools & MCP reload guidance, never Claude-only setup commands.

On Pi this workflow refuses because a dedicated Grok consent/lifecycle adapter is not available. Setup leaves pairing off on every host. See [Cursor host notes](/compatibility/cursor#grok-pair-route-safety) and [costs](/operation/costs).
