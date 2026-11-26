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

Google route checks run only for an installed Gemini or Antigravity CLI and use environment variable names only. Doctor warns about possible alternate billing when Gemini sees `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI` or `GOOGLE_APPLICATION_CREDENTIALS`, or when Antigravity sees `AGY_ADC_AUTH` or `GEMINI_API_KEY`. With only `GOOGLE_CLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT_ID`, or with no signals, the route check is skipped and the seat and funding remain unverified. Cached Cloud credentials and pay-as-you-go settings may still affect billing. Doctor leaves Gemini CLI registration unchecked because its settings file also holds authentication preferences. See [Google authentication](/operation/authentication) for the consumer-plan terms boundary.

## Optional live check

`ask-llm doctor --live` skips Gemini and Antigravity model exercises because their routes and funding are unverified. It exercises other ready, permitted providers with a small prompt in a temporary directory. That prompt may consume quota or incur provider charges.

Live doctor also reports [Antigravity quota metadata](/providers/antigravity#quota-diagnostics) on supported versions. Default doctor starts zero agy processes.

## Formats

```bash
ask-llm doctor --format toon
ask-llm doctor --format toon --full
```

JSON remains the full automation interface; TOON is a bounded, versioned, provider-only presentation and cannot be combined with `--live`. Doctor exits 1 on an error, 0 on an OK or warning report, and 2 on invalid arguments. The existing server's `doctor` mode is provider-only; `ask-llm doctor` adds hosts in text and JSON formats.

Use `ask-llm doctor --help` for the exact options. If the report is healthy but a call fails, inspect [authentication](/operation/authentication), the provider's limits, and [troubleshooting](/resources/troubleshooting).
