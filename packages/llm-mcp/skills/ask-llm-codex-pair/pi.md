### Pi adapter

Run the native `/codex-pair` command in a trusted project with a `.codex-pair/context.md` marker. The command asks in TUI before sending bounded edited-file and marker context to the selected CLI account, which may consume quota or incur charges.

- Select `reviewer: codex` (the default) or `reviewer: claude` in the initial fenced frontmatter. Plain context uses Codex. A Codex-family writer can use explicit Claude review, which selects `claude-opus-5-5`. A reviewer refuses an edit from its own family. An unknown writer can proceed with a matching grant.
- Use `/codex-pair status` to see the selected route and authorization. Changing reviewer requires a new affirmative grant. Declining keeps the old grant. `/codex-pair revoke` removes it. Legacy grants authorize Codex only.
- Findings from settled successful edits are persistent and advisory in TUI, RPC and long-lived JSON modes. Keep `.codex-pair/` out of git. One-shot print skips pairing.

See the [Pi guide](https://lykhoyda.github.io/ask-llm/compatibility/pi#pi-codex-pair-consent) for marker examples, account consent, settings and rollback details.
