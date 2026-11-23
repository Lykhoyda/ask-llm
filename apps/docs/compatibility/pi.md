---
description: Native tools, portable workflows and explicit per-project pairing consent.
---

# Pi host notes

Pi owns your conversation, host model, tools and lifecycle. Ask LLM supplies native tools backed by the same provider executors and schemas as other hosts; Pi does not need MCP configuration. Your Pi account and reviewer accounts have separate authentication and billing.

## Prerequisites

- Node.js 24+
- Pi 0.83.0 or newer
- one or more provider runtimes:
  - authenticated `codex` CLI for Codex reviews, images, verification, and default pairing
  - authenticated `claude` CLI for explicitly selected Claude pairing
  - authenticated enterprise `gemini` CLI for Gemini
  - local Ollama server with the requested model pulled
  - authenticated [supported `agy` version](/providers/antigravity#prerequisites) for Antigravity

The published Pi support floor always matches the oldest exact host version exercised by the `pi-package-smoke` CI matrix; currently both the 0.83.0 floor and current 0.84.2 host are tested in isolated environments.

The extension reads provider credentials only indirectly by invoking the provider package/CLI. It never copies keys or Pi credentials.

## Connection

Follow [Install](/start/install), then restart Pi or use `/reload`. Setup registers the globally installed extension as a local package and fills the shared skills folder. The extension prints a notice naming `ask-llm setup --host pi` if no portable workflow is found. Earlier npm installations are left unchanged with [migration guidance](/reference/migration).

## Skills and tools

Invoke a skill explicitly with `/skill:<name>` or describe the workflow naturally. Pi progressively loads the same canonical `SKILL.md` files used by Claude Code, then follows their Pi adapter.

Representative commands:

```text
/skill:ask-llm-review
/skill:ask-llm-multi-review
/skill:ask-llm-compare gemini,codex explain this API design
/skill:ask-llm-brainstorm antigravity,codex review this architecture
/skill:ask-llm-brainstorm grok@cursor-agent:grok-4.7-high,codex@cursor-agent:gpt-6.2-sol-high review this architecture
/skill:ask-llm-codex-image create a monochrome architecture diagram
/skill:ask-llm-codex-verify
/skill:ask-llm-codex-pair
```

The Cursor `gpt-6.2-sol-high` example follows the `<codex-slug>-high` naming but is unverified; confirm the exact ID with `agent --list-models` before use.

Pi reads these skills from the shared skills folder that `ask-llm setup --host pi` fills; the package itself ships only the extension. `ask-llm-fable-review` is not installed: independent Fable review would require a nested Pi session or provider bridge. `ask-llm-grok-pair` is installed for other hosts and refuses on Pi, because Grok pairing still needs a dedicated Pi consent/lifecycle adapter.

For `/skill:ask-llm-codex-pair`, check the [portable writer applicability rule](/advanced/codex-pair) first. The native `/codex-pair` commands described below use their separate consent flow.

Native tools (Pi has no MCP client, so the extension registers them with the MCP server's input schemas; see the [host parity matrix](https://github.com/Lykhoyda/ask-llm/blob/main/docs/HOST-PARITY.md)):

| Tool | Contract |
|---|---|
| `ask-llm` | the MCP `ask-llm` schema (`provider`, `model`, `reasoningEffort`, `includeDirs`, `sessionId`, `harness`, `preferred`, `noFallback`, `sandbox`) and the same `AskResponse` in `details.structuredContent`; `provider` uses the same detected availability and exclusions as MCP |
| `multi-llm` | the MCP `multi-llm` schema and report; omitted `providers` means every detected provider |
| `ask-cursor-agent` | the MCP schema: model-neutral Cursor harness with separate provider + exact account model ID, safe relative `includeDirs`, and optional returned/resumed Cursor `sessionId`; the exact ID is echoed as `model`, Cursor's label stays separate as `reportedModel`, and read-only ask mode never falls back |

Deprecated aliases, kept for existing skills and prompts:

| Tool | Contract |
|---|---|
| `ask-codex` | complete prompt/model/reasoning/session/includeDirs/preferred/noFallback/sandbox schema; read-only default |
| `ask-gemini` | prompt/model/session schema and canonical quota fallback |
| `ask-grok` | prompt/model/reasoning plus explicit `xai-api` or `grok-cli` harness; no model/harness fallback |
| `ask-ollama` | prompt/model/session schema; local-only, no silent model substitution |
| `ask-antigravity` | prompt/includeDirs schema and supported-`agy` checks |
| `ask-multi` | same prompt to 2–5 unique providers via bounded `Promise.allSettled`, with per-provider options; stable input-order records and explicit failures |

Displayed tool text is bounded to Pi's 50KB/2000-line policy; structured payloads remain complete. Provider failures throw, so Pi records `isError: true`; Ask LLM usage remains raw metadata in `details` and is not misreported as Pi host-model cost.

## Pi codex-pair consent

Create `.codex-pair/context.md` in a trusted Pi project. Choose the reviewer in the initial fenced frontmatter and put project invariants below the fence. Keep `.codex-pair/` out of version control.

For a Codex review of edits from an independent writer:

```markdown
---
reviewer: codex
reasoningEffort: high
---
Amounts use integer cents. Retrying a payment must preserve its idempotency key.
```

If your Pi writer is OpenAI or OpenAI Codex, explicitly choose Claude:

```markdown
---
reviewer: claude
timeoutMs: 600000
---
Amounts use integer cents. Retrying a payment must preserve its idempotency key.
```

In interactive Pi, run `/codex-pair` to approve the selected CLI. The prompt names the CLI, model, any Codex quota fallback, and the amount of edited-file content and marker body the review can receive. It states that the CLI uses its locally configured account; it does not display an account identifier. Check that CLI's login before granting consent. Codex and Claude can use different accounts. Each review uses the selected account's quota or billing. Project trust and an affirmative grant for the canonical project root and selected reviewer are both required. Claude Code's template and catch-up commands provide no Pi grant.

Use `/codex-pair status` to check the selected reviewer and its authorization. A grant for a different reviewer requires a new confirmation and replaces the previous grant. Declining leaves the previous grant in place and sends nothing. Use `/codex-pair revoke` to remove the grant, including when the marker frontmatter is malformed.

The user-owned allowlist is at `$PI_CODING_AGENT_DIR/ask-llm/codex-pair-projects.json` (usually `~/.pi/agent/ask-llm/codex-pair-projects.json`). Existing version 1 grants authorize Codex only. A grant or revoke migrates valid entries to version 2 and keeps other projects' timestamps. A legacy build reads the version 2 file as unauthorized. Run one build against the allowlist at a time. If you roll back, use a fresh legacy allowlist and explicitly reauthorize Codex through the older Pi command. Claude grants do not carry back. A previously reviewed file can receive one cold review on its next eligible edit.

### Writer identity and review settings

Pi uses the model that wrote the edit and separately checks its current model selection before dispatch and delivery. `openai` and `openai-codex` are Codex-family writers, `anthropic` is Claude-family, and `xai` is Grok-family. A reviewer refuses a writer from its own family. A custom or router provider whose family Pi cannot establish is treated as unknown. Matching reviewer consent still applies, and the finding includes the reported provider/model when available. The [portable skill writer rule](/advanced/codex-pair) applies when invoking the skill.

Plain markers use the defaults. A setting below the initial fence is project context. Pi refuses invalid reviewer values and unclosed initial frontmatter. The precedence for valid settings is:

| Setting | Pi resolution |
|---|---|
| `reviewer` | `codex` by default, or explicit `claude` |
| Codex `model` | Marker, `ASK_CODEX_MODEL`, then `gpt-6.2-sol` |
| Codex `reasoningEffort` | Marker, `ASK_CODEX_REASONING_EFFORT`, then `high`. Accepted values are `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. CLI and model support determines which values work. |
| Codex `fallbackModel` | Marker, `ASK_CODEX_FALLBACK_MODEL`, then `gpt-6.1-terra`. A primary quota failure can make one attempt at a distinct configured fallback on the same CLI and account. |
| Claude model and effort | The Claude CLI always selects `claude-opus-5-5`. Effort is unknown and there is no fallback. Codex pins and `ASK_CLAUDE_MODEL` do not influence this route. |
| `timeoutMs` | Per attempt, marker then `ASK_CODEX_TIMEOUT_MS` or `ASK_CLAUDE_TIMEOUT_MS`. Codex also uses legacy `GMCPT_TIMEOUT_MS` before its 800000 ms default. Claude defaults to 600000 ms. |
| `debounceMs` and `debounceMaxMs` | Marker, `ASK_CODEX_DEBOUNCE_MS` and `ASK_CODEX_DEBOUNCE_MAX_MS`, then 15000 and 60000 ms. A zero settle delay is valid. The cap must be positive. |
| `maxFileBytes` | Positive UTF-8 byte cap from the marker, `CODEX_PAIR_MAX_FILE_BYTES`, then 20000 bytes. Oversized file or marker content gets a partial view. |
| `surfaceThreshold` | Marker value `high`, `med` (default), or `low`. |

Numeric settings must be integers no larger than 2147483647; invalid values fall through to the next setting. Timeouts, model errors and unrecognized reviews produce a failure without a cross-provider retry. Each reviewer runs from the canonical project root. Codex runs read-only. Claude uses safe mode and read-only tools. If Claude refuses to start inside a Claude Code session, launch Pi separately.

### Findings and lifecycle

Pi observes successful built-in `edit` and `write` events, coalesces each edit burst and reviews settled file content. It persists findings, then delivers them as advisory messages without starting another model turn. The header identifies the selected reviewer and attempt model, any Claude model reported by the CLI, and the writer. Pi treats all findings as advisory, including when a marker sets `blockOn: HIGH`. Pi log entries do not count toward Claude Code's Stop gate or catch-up coverage.

```text
/codex-pair                 # check or grant consent
/codex-pair status
/codex-pair revoke
/codex-pair-pause
/codex-pair-resume
/codex-pair-ack <hash> <reason>
```

Pause, revoke and incompatible model changes suppress work already in progress. Shutdown, reload, new session, resume and fork close the old session, cancel its active reviewer and release its locks. Compatible pending findings can replay after restart. Claims prevent concurrent delivery, and each replay preserves `details.findingId` so receivers can deduplicate a crash after delivery and before cleanup. Logs, cache, pause state, acknowledgements and consent survive shutdown.

Pairing works in TUI, RPC and long-lived JSON modes. Grant consent in TUI. One-shot print mode skips pairing.

## Host feature matrix

See the [host parity matrix](https://github.com/Lykhoyda/ask-llm/blob/main/docs/HOST-PARITY.md) for tools, skills, options, diagnostics, pairing, subagents, and the Stop gate across all supported hosts. The following workflow-specific limits supplement that matrix:

| Capability | Claude Code | Cursor Agent | Codex CLI host | Pi |
|---|---:|---:|---:|---:|
| Independent `fable-review` | Yes | No; excluded | No | No; excluded |
| `codex-image` | Yes | provider-dependent | provider-dependent | Yes, explicit workspace-write opt-in |
| Grok pairing | Explicit Cursor/xAI/CLI routes | Direct xAI/CLI routes | Direct xAI/CLI routes | Skill is installed but refuses; no consent/lifecycle adapter |
| Pairing in one-shot print mode | Hook-dependent | On-demand skill | On-demand skill | **No** |

## Update and remove

Follow [Upgrade and remove](/start/upgrade-remove) for Pi package removal, workflow cleanup and retained user state, and [Migration](/reference/migration) for earlier npm installations.

## Troubleshooting

- **Package absent:** run `pi list`; rerun the [Install](/start/install) setup step.
- **Skills absent:** confirm `enableSkillCommands` is true, run `/reload`, and check `/skill:ask-llm-review`; if it is missing, run `ask-llm setup --host pi`. `ask-llm-fable-review` should remain absent.
- **Project package absent:** trust the project (`/trust`, then restart) or use `--approve` for a one-run check.
- **Pairing refuses a marker:** project trust and user-owned consent are both required; run `/codex-pair` in interactive Pi.
- **Provider unavailable:** run the named CLI directly once to install/authenticate it (`codex`, `gemini`, `agy`) or start Ollama and pull the configured model. The native tool returns the provider package's actionable error.
- **Pairing seems silent:** use TUI/RPC/long-lived JSON, check pause status with `/codex-pair`, and inspect `.codex-pair/log.jsonl`. Print mode is intentionally unsupported.
- **Need a refresh after update:** run `/reload` or restart Pi.
