# Provider Parity Matrix

The four providers deliberately do NOT behave identically — each difference below is either grounded in a provider's real constraints or is an accepted gap with the reasoning recorded. This doc exists so a difference is never mistaken for an oversight (and so a future "align X across providers" idea starts from the actual rationale). Found by the 2026-07-02 audit; companion to ADR-128.

Factory defaults are literals (`FACTORY_DEFAULT_MODEL` in each package's `constants.ts`); the live default may differ via `ASK_<PROVIDER>_MODEL`.

| Dimension | Gemini | Codex | Ollama | Antigravity |
|---|---|---|---|---|
| Transport | `gemini` CLI spawn | `codex exec --json` spawn | HTTP `POST /api/chat` (native fetch) | `agy -p` spawn |
| Factory default model | `gemini-3.1-pro-preview` | `gpt-5.5` | `qwen3.6:27b` | `Gemini 3.1 Pro (High)` |
| Fallback | quota → `gemini-3.5-flash` | quota → `gpt-5.4-mini` (ADR-126), pinned-incompatible 400 → actionable message (ADR-127); `/codex-review` + `/brainstorm` additionally have an opt-in preferred rung, unconditional `gpt-5.5-pro` → `gpt-5.5` above the quota fallback (ADR-132) | **none by design** — local means the user pulls what they intend to run; actionable `ollama pull` error (#191) | rate-limit only → `Gemini 3.5 Flash (High)` (ADR-125) |
| Timeout default | 210s | **800s** — reasoning models spend real wall time before first output (#45) | 600s — 27b models load/generate slowly on modest hardware; the bound catches wedged servers, not slow generation | 300s |
| Timeout env var | `ASK_GEMINI_TIMEOUT_MS` | `ASK_CODEX_TIMEOUT_MS` | `ASK_OLLAMA_TIMEOUT_MS` | `ASK_ANTIGRAVITY_TIMEOUT_MS` |
| Session mechanism | CLI `--resume <id>`; surfaces as `[Session ID: ...]` | native threads (`thread_id`); surfaces as `[Thread ID: ...]` — codex's own terminology, deliberately not renamed | sessions stored on disk (`os.tmpdir()/ask-llm-sessions`, 24h, 0700/0600); `[Session ID: ...]` | **single-turn only** (agy has no resumable headless session) |
| Empty-string `sessionId` | starts fresh + disables response cache (ADR-063 parity, fixed 2026-07-02) | same | same | n/a |
| includeDirs | `ask-gemini-edit` only (`--include-directories`), validated via shared `relativeDirSchema` | `ask-codex` + `ask-codex-edit` (`--add-dir`), validated (2026-07-02) | n/a (HTTP; no file access) | `ask-antigravity` (`--add-dir`), validated (2026-07-02 — flagged by Codex review of this very doc; extra important since agy runs `--dangerously-skip-permissions`) |
| Edit mode | `ask-gemini-edit` — changeMode OLD/NEW blocks + chunking + `fetch-chunk` | `ask-codex-edit` — `--output-schema` structured edits, read-only sandbox, no chunking (responses are schema-bounded) | none — accepted gap: local models are the weakest editors; propose via prose | none |
| Progress fidelity | real streaming (stream-json assistant deltas) | keep-alive only (JSONL arrives at end) | single 150-char tail on completion (non-streaming API call) | keep-alive only |
| Read-only guarantee | n/a (CLI is read-only in `-p` mode) | edit mode runs `--sandbox read-only` | n/a | **soft only** — `READ_ONLY_PREAMBLE` prompt guard; agy has no hard read-only flag (open BUGS.md entry) |
| Error-signal detection | `QUOTA_PATTERNS`, workspace-trust, tier-cutoff enrichment | `QUOTA_SIGNALS`, `ARCHIVED_SESSION_SIGNALS`, `MODEL_UNAVAILABLE_SIGNALS` | `MODEL_NOT_FOUND_SIGNALS`, server-unreachable, timeout | `RATE_LIMIT_SIGNALS` |
| Concurrency | none needed | none needed | none needed | in-process mutex — concurrent `agy` runs cross-wire the transcript-scrape fallback |

Shared behavior (identical everywhere, enforced by shared code + tests): 25s keep-alive progress (`registerTools`, ADR-053), `askResponseSchema` structured output, response cache keyed per provider and disabled for session-bearing calls, 16KiB stdin threshold for CLI providers, 100KB prompt cap, duplicate-tool-name fail-fast.

Known deliberate NON-alignments to leave alone unless a user asks:
- **Timeout spread (210s–800s)** encodes real model behavior differences, not inconsistency.
- **"Session ID" vs "Thread ID"** labels match each CLI's own vocabulary; renaming would break users' mental mapping to `codex resume`.
- **Ollama's missing edit mode and no-fallback** are product decisions (#191, ADR history), not backlog.
- **Codex review/brainstorm tier (ADR-132):** `/codex-review` and `/brainstorm`
  prefer `gpt-5.5-pro` and downgrade unconditionally to `gpt-5.5`, then to
  `gpt-5.4-mini` on quota. This preferred rung is opt-in via the `preferred`
  arg (automatic for those two commands); `ASK_CODEX_PREFERRED_MODEL` only
  customizes which model the preferred tier requests, it does not enable it.
  Preferred does NOT apply to the raw `ask-codex` tool, `codex-pair`,
  `/multi-review`, or `/codex-verify`.
