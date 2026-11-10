### Pi adapter

Pi requires project trust, this repository marker, and explicit user-owned allowlist consent through `/codex-pair`. Pairing is asynchronous in TUI/RPC/long-lived JSON modes, uses `tool_result`, and surfaces findings non-blockingly. One-shot print mode, blocking Stop-gate parity, and nested Fable execution are unsupported.

To set up pairing on Pi:

1. Create `.codex-pair/context.md` in the project root with the reviewer's project context, as described in [reference.md](reference.md#how-to-enable-it).
2. Keep `.codex-pair/` out of git by adding it to `.gitignore`.
3. In interactive Pi on a trusted project, run `/codex-pair` and confirm the prompt to grant consent. Run `/codex-pair` again to see status, or `/codex-pair revoke` to withdraw consent.
