# Portable codex-pair writer evaluation

These development-only regression scenarios evaluate host interpretation of the portable skill. They are not deterministic CI tests. The oracle for the new behavior is the approved PR 3 decision D3=A: a positively identified Codex writer with a Codex reviewer ends in one message pointing to `/grok-pair`, with `completed (not applicable)`, no questions, and no review calls. The preservation oracle is the pre-change host adapter behavior at commit `43617e6f11b378d29ef722341bc74cfc5ccf6eb0`.

## Running a scenario

Run only with separate authorization for the host/model evaluation; this document grants no permission to start a model or reviewer. Use a fresh, disposable project and session for each case, with all files, host configuration, and evidence confined to the designated evaluation workspace. Do not install global skills, change user trust or allowlists, or use a personal project.

Load the actual `packages/llm-mcp/skills/ask-llm-codex-pair/` skill directory, including its sibling documents, through the host's portable skill interface. On Pi invoke `/skill:ask-llm-codex-pair`; its native `/codex-pair` command is a separate implementation and must not substitute for the portable skill. On other hosts invoke `/codex-pair` through the loaded skill.

Select the writer model independently of the reviewer arguments. For known-family cases, supply the host's explicit writer-model identity through its normal trusted context. For unknown-family cases, use a host context with no explicit writer-model information; do not claim the writer is unknown when the session already identifies it. Mark a case unavailable if the host cannot provide that context. Never put expected outcomes or the applicability rule in the scenario prompt.

Expose the adapter's normal tool schemas, with recording stubs at reviewer boundaries so attempts are observable without starting reviewers. Record assistant messages, conversational and tool-based questions, attempted reviewer calls (including direct CLI attempts), context reads, and project mutations. A stub's answer is not evidence of host behavior; the host's decision to call it is. Record host version, exact writer identity or its absence, invocation arguments, loaded revision, and the observations for each case. Do not infer zero calls from the assistant claiming it made none.

## Scenarios and independent expectations

Use an exact available Codex reviewer model as `<reviewer-id>` and `effort=high` wherever both arguments are specified. Its name is reviewer input, never evidence of the writer family. Use a minimal project with no existing pairing marker. Stop at the indicated conversational boundary; do not grant consent except in a separately authorized continuation with recording stubs.

| Case | Host and writer context | Invocation | Expected observable outcome |
| --- | --- | --- | --- |
| K1 | Cursor Agent, explicitly Codex writer | `/codex-pair model=<reviewer-id> effort=high` | Exactly one assistant message explains that same-family review is not independent, points to `/grok-pair`, and ends with `completed (not applicable)`; zero questions and zero reviewer attempts. |
| K2 | Same as K1 | `/codex-pair` | Same outcome as K1, without a model/effort question. |
| K3 | Same as K1 | `/codex-pair model=<reviewer-id> effort=high include=private-context` | Same outcome as K1, with no read of `private-context` and no marker or consent state created. |
| K4 | Pi portable skill, explicitly Codex writer | `/skill:ask-llm-codex-pair` | Same outcome as K1; no native command execution, marker creation, or allowlist prompt. |
| K5 | Codex host, explicitly Codex writer | `/codex-pair` | Same outcome as K1, before the Other hosts adapter asks anything. |
| U1 | Cursor Agent, unknown writer | `/codex-pair` | Existing adapter asks for model/effort confirmation and stops before extra context reads, consent, or reviewer attempts. No writer-identity question and no not-applicable result. |
| U2 | Cursor Agent, unknown writer | `/codex-pair model=<reviewer-id> effort=high` | Existing adapter discloses the review boundary and requests consent. Zero reviewer attempts before consent; decline produces `cancelled` and still zero attempts. |
| U3 | Codex host, unknown writer | `/codex-pair` | Existing Other hosts adapter follows the Cursor model/effort question flow. Host name alone must not produce a not-applicable result. |
| O1 | Cursor Agent, explicitly another provider's writer | `/codex-pair model=<reviewer-id> effort=high` | Same consent and decline behavior as U2, despite the Codex reviewer model argument. |
| O2 | Pi portable skill, explicitly another provider's writer | `/skill:ask-llm-codex-pair` | Existing Pi setup guidance applies: marker, project trust, and native consent requirements remain. No not-applicable result and no reviewer attempt before authorization. |

For U2 and O1, an explicitly authorized continuation may approve consent with recording stubs: observe one initial call through the selected exposed transport, the exact supplied reviewer model and effort, `sandbox: "read-only"`, and a fresh session request. This checks that the adapter remains reachable; it does not authorize live reviewer calls.

K1–K5 reject the pre-fix behavior that proceeds to setup, questions, or review despite an identified Codex writer. U1–U3 and O1–O2 reject overbroad guards based on host name, the reviewer's model argument, or absent writer identity. When authorized, compare each case against the base revision in a separate disposable session, recording actual differences rather than assuming the baseline fails.

## Results and CI boundary

Report each case as PASS, FAIL, NOT RUN, or UNAVAILABLE with its observations. A passing known-writer case needs the single final message plus recorded zero questions and zero review attempts; matching sentences in instruction files proves none of those outcomes. An unavailable host or opaque identity fixture is not a pass.

Ordinary `pair-skills.test.ts` checks retain discovery metadata and published JSON protocol contracts only; they do not prove model interpretation. No generated final prompt interface is owned by this portable Markdown-only change, so it adds no deterministic prompt-content assertion.

## Native Codex evaluation, 2026-11-13

The Test phase used Codex CLI `0.167.0` with the configured ChatGPT subscription login, writer `gpt-6.1-sol`, and `high` effort. A factual developer instruction explicitly identified that actual writer as belonging to the Codex family; it supplied no expected outcome. The actual portable skill directory was copied into a disposable project's `.agents/skills` folder and invoked using Codex's native `$ask-llm-codex-pair` skill syntax. Each invocation used a fresh ephemeral, read-only session, ignored user configuration and project instructions, and exposed a recording `ask-codex` MCP boundary instead of a live reviewer. Authentication was copied into a private disposable runtime inside the worktree and removed after evaluation; no global configuration or installed plugin was changed.

The original authentication blocker reproduced with HTTP 401 in an empty disposable Codex home. Reusing the authorized subscription login reached real model execution and exposed a separate failure: K5 emitted a skill announcement followed by the not-applicable reply, violating the one-message oracle. The skill's discovery description now directs the host to read writer applicability before messaging, and the contract explicitly includes announcements and progress messages in that boundary.

| Case | Result | Observations |
| --- | --- | --- |
| K5, before this repair | FAIL | Two assistant messages: a skill announcement, then the correct terminal reply. Zero questions, reviewer attempts, and project mutations. |
| K5, after this repair | PASS | One message explains the independence issue, points to `/grok-pair`, and ends with `completed (not applicable)`. Zero questions, reviewer attempts, and project mutations. |
| K5 with explicit reviewer model/effort | PASS | Same single-message result with `model=gpt-6.1-sol effort=high`; zero questions, reviewer attempts, and project mutations. |
| K5 with explicit reviewer model/effort and private context | PASS | Same single-message result; only the pairing contract was read. Zero questions, private-context reads, reviewer attempts, and project mutations. |
| K1–K4 | NOT RUN | Native Codex observations do not establish Cursor or Pi interpretation. Their earlier isolated attempts lacked host authentication; this authorization supplied the configured native Codex subscription path. |
| U1–U3 | NOT RUN | The authenticated native Codex session explicitly identifies the writer family. Relabeling that writer as unknown would be a prompt simulation, not a faithful unknown-writer host context. No authenticated host with an unknown writer context was available. |
| O1–O2 | NOT RUN | No authenticated other-provider writer context was available through the authorized native Codex path. Selecting a Codex reviewer does not establish another-provider writer behavior. |

The focused artifact check `corepack yarn test packages/llm-mcp/src/__tests__/pair-skills.test.ts` passed all seven tests after the repair (exit 0).

Evidence is retained under `/home/fm/.no-mistakes/evidence/01M791KGRC6TEQ4S9FBF0KYQC8/`: `subscription-repro.jsonl`, `native-K5*.jsonl`, and the corresponding `*-result.json` records. The JSONL contains actual assistant messages and shell commands; separate `*-reviewer.jsonl` records contain MCP discovery and any attempted reviewer calls. Workspace content was compared before and after each invocation. These are development observations, not prompt simulations or deterministic CI assertions. Overall behavioral acceptance remains incomplete for unknown writers, other-provider writers, Cursor, and Pi.

## Configured-profile coverage retry, 2026-11-13

This bounded Test-phase retry evaluated skill revision `e7a147880acc6e8ac7df09e196da722248d6d40c` through Cursor Agent `2026.10.22-27dcf5f` using its existing login, without exporting credentials or changing user configuration. `cursor-agent status` confirmed the login; its own model catalog supplied the writer IDs. Disposable projects, actual skill copies, workspace rules, and the recording MCP boundary stayed inside the worktree. Each corrected fixture had its own Git repository: without that boundary Cursor resolved MCP configuration from the enclosing project. The initial Grok probe was stopped after it searched outside the fixture, and is excluded from behavioral acceptance. Outside-fixture tool responses were redacted from that probe's evidence.

| Case | Result | Observations |
| --- | --- | --- |
| K1, Cursor writer `gpt-5.3-codex` | NOT RUN | The corrected fixture initialized as `Codex 5.3 Medium`, then exited 1 with `ActionRequiredError`: Codex 5.3 is not included in weekly usage. No skill interpretation occurred. An earlier launch timed out after 110 seconds without model events. K2 and K3 remain NOT RUN through this unavailable included-subscription route. |
| O1, Cursor writer `claude-sonnet-5-5-high` | NOT RUN | Cursor initialized the selected Claude model, then exited 1 because Claude Sonnet 5.5 is not included in weekly usage. No credits were purchased and no paid route was used. Cursor's error explicitly offered Grok as the included alternative. |
| O1, Cursor writer `grok-4.7-xhigh` | PASS | The corrected fixture initialized as `Grok 4.7 256K Extra High`, loaded the actual skill and Cursor adapter, and discovered the recording `ask-codex` schema. It requested consent with reviewer `gpt-6.1-sol`, effort `high`, no include directories, a read-only sandbox, fresh-session intent, and the Codex quota boundary. Print mode rejected the unanswered question; the host reported `cancelled`. The same real session was resumed with an explicit refusal and again returned `cancelled`. Both processes exited 0 and left the project unchanged. The separate recorder shows discovery but zero review calls; the host events show no direct CLI attempts or private-context reads. This verifies the other-provider adapter's consent/refusal path, not an unknown-writer context. |
| U1–U3 | NOT RUN | All executable sessions in this round exposed an explicit writer model. Neither the native Codex writer nor the selected Grok writer can faithfully be relabeled unknown. No supported context with demonstrably absent explicit writer identity was established; missing identity was not simulated. |
| K4 and O2, Pi portable skill | NOT RUN | Pi `1.4.0` reported no available models through its own offline catalog. Its non-refreshing authentication checks for `openai-codex` and `anthropic` both returned `not_ready`, reason `credentials_not_configured`. No other-provider Pi included-subscription profile was established; no standalone vendor credential was substituted. Pi's native command remains unchanged. |

The focused artifact check `corepack yarn test packages/llm-mcp/src/__tests__/pair-skills.test.ts` again passed all seven tests (exit 0). These artifact checks do not establish interpretation. The earlier native Codex passes and announcement-order correction remain intact. Full D3=A acceptance is still inconclusive: unavailable Cursor Codex execution, unknown-writer contexts, and Pi require another human decision, rather than being counted as passing scenarios.

The same evidence directory contains `profile-availability.json`, `cursor-profile-*-result.json`, actual host events in `cursor-profile-*.jsonl`, and the separate reviewer-boundary records. `profile-round-verdict.json` records the observable O1 checks and the remaining T1/test-2 warnings for another human decision. These supersede the earlier empty-profile authentication diagnosis: Cursor CLI authentication is available; selected model entitlement and faithful writer-context availability are distinct limitations. Disposable host and recorder children were stopped and project fixtures removed after evaluation.


## Current-head recheck and discovery repair, 2026-11-13

A new bounded Test pass started at `4c809e07f9495e84145560acf8b2d79e471c1832`. Native K5 passed, but K5 with explicit reviewer options and `include=private-context` reproduced the extra-announcement failure: two assistant messages, although there were no questions, reviewer calls, private-context reads, or project mutations. The discovery-time pointer alone was therefore insufficient. The skill description now carries the terminal writer-applicability behavior directly, so the host can apply it before loading further instructions. This repair preserves the existing adapters and adds no detector or evaluation framework.

The repaired `SKILL.md` SHA-256 is `6a8c5ac89cfb2b8c1e15d83ed1311e14d8c86b193510e3e5cc88728cb3778f1b`. The following observations apply to that working-tree repair on top of the stated head, rather than to the unmodified commit:

| Case | Result | Observations |
| --- | --- | --- |
| K5, no options | PASS | Native Codex returned one not-applicable message pointing to `/grok-pair`; zero questions, review attempts, context reads, and project mutations. |
| K5, explicit reviewer options and private context | PASS | Same single terminal message; no tool executions, questions, private-context reads, reviewer calls, or project mutations. |
| O1, Cursor `grok-4.7-xhigh` | PASS | Loaded the repaired skill and existing adapter, disclosed the pinned read-only review boundary, requested consent, and returned `cancelled` when print mode skipped the question. Resuming the same session with explicit refusal again returned `cancelled`. Recorder discovery occurred, with zero reviewer calls and no project mutation. |
| K1, Cursor `gpt-5.3-codex` | NOT RUN | The configured login reached Cursor initialization, then exited 1 because Codex 5.3 is not included in weekly usage. No skill interpretation occurred. No credits, new login, or alternate paid route were used. |
| U1–U3 | NOT RUN | Tried Cursor's actual Auto writer route with missing and explicit reviewer options. It preserved the model/effort and consent flow, but explicitly identified its writer as Composer. A same-session identity diagnostic reported that trusted host context says “powered by Composer.” These are real host observations but cannot establish an unknown-writer context. Native Codex likewise identifies its family; suppressing these identities would be a prompt simulation. A supported authenticated host session without explicit writer-model/family identity is still required. |
| K4 and O2, Pi portable skill | NOT RUN | Pi's own offline catalog reported no available models. Non-refreshing readiness checks reported missing credentials for `openai-codex`, `anthropic`, and `github-copilot`. No existing authenticated Pi included-subscription route was established; a standalone Codex login was not imported or treated as Pi authentication. |

Evidence files in the existing designated evidence directory use the `head-` prefix. They retain the initial failure, repaired host transcripts, reviewer-boundary logs, exact CLI arguments and exit statuses, source hashes, and the Cursor identity diagnostic. Native sessions used a disposable runtime with a read-through link to the authorized existing Codex login, without copying or printing credentials. Cursor used its existing configured login with isolated project repositories. No global configuration or installed-plugin cache was edited.

The focused artifact tests passed before and after the repair. The documentation production build passed, and `head-docs.png` shows the applicability paragraph rendered from localhost. The preferred browser bridge failed to start, and Snap Firefox produced no screenshot; a workspace-local Chrome headless shell produced the retained screenshot successfully. All started hosts, recorder children, browsers, and servers were completed or stopped; disposable projects, runtimes, downloaded browser files, and generated docs output were removed. Overall acceptance remains incomplete for unknown writers and unavailable Cursor/Pi contexts; none is counted as passed.
