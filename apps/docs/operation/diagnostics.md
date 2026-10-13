---
description: Distinguish installation, registration, authentication, permission and a successful provider call.
---

# Diagnostics / doctor

Run diagnostics before changing configuration:

```bash
ask-llm doctor
ask-llm doctor --json
```

The report distinguishes these states:

| State | Meaning |
|---|---|
| Installed | The provider runtime or host is present |
| Registered | The host has a registration; this alone does not prove tool availability |
| Authenticated | Authentication evidence is available; unknown means it was not established |
| Permitted | The provider's execution gate allows a call |
| Exercised | A live provider call succeeded |

Ordinary diagnostics do not make paid inference calls. The host report includes restart instructions, manual guidance and the host's [compatibility matrix](/compatibility/hosts) rows. A leftover config directory is a clue, not proof that a host is installed.

## Optional live check

`ask-llm doctor --live` exercises ready, permitted providers with a small prompt in a temporary directory. It may consume quota or incur provider charges. Run it only when you choose to test that boundary. Skipped providers are not reported as successful. It does not run a review of your project.

It also checks [Antigravity quota](/providers/antigravity#quota-diagnostics); that reference explains the version gate, sandboxing and why default doctor leaves agy's version unchecked.

## Formats

```bash
ask-llm doctor --format toon
ask-llm doctor --format toon --full
```

JSON remains the full automation interface; TOON is a bounded, versioned, provider-only presentation and cannot be combined with `--live`. Doctor exits 1 on an error, 0 on an OK or warning report, and 2 on invalid arguments. The existing server's `doctor` mode is provider-only; `ask-llm doctor` adds hosts in text and JSON formats.

Use `ask-llm doctor --help` for the exact options. If the report is healthy but a call fails, inspect [authentication](/operation/authentication), the provider's limits, and [troubleshooting](/resources/troubleshooting).
