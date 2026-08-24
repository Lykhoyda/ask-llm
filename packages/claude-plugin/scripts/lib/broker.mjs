// App-server broker interface (ADR-090, refined per ADR-093).
//
// Future home of the long-lived codex sidecar that replaces per-edit cold
// spawns with persistent JSON-RPC requests. Today this module defines the
// API surface and stable state-file layout — the implementation lands
// across Tier 3 follow-on milestones 2–4 tracked in docs/ROADMAP.md.
//
// **Status:** interface defined; implementation deferred. The `isBrokerEnabled`
// check returns false until ASK_CODEX_BROKER=1 ships alongside a real
// implementation. The hook MUST treat broker absence as a no-op and fall
// back to the existing per-edit codex spawn (ADR-077). This keeps the
// happy path byte-identical to v0.6.6 until the broker stabilizes.
//
// See ADR-090 for original design rationale (transport, lifecycle,
// failure modes, stale-daemon recovery). See ADR-093 for the protocol
// discovery findings that refined this interface against the real
// `codex app-server` JSON-RPC surface (codex-cli 0.130.0+):
//   - Transport: unix:// (POSIX) / ws:// (Windows), via `--listen` flag
//   - Handshake: JSON-RPC `initialize` with clientInfo
//   - Per-review: `thread/start` (ephemeral) + `turn/start` (with
//     outputSchema constraint) + listen for `turn/completed` notification
//   - Cancellation: `turn/interrupt` on the in-flight turn id
//   - Health probe: `model/list` (cheap) or `initialize` with deadline

import { join } from "node:path";
import { createRpcClient } from "./broker-rpc.mjs";
import { connectWebSocket } from "./broker-transport.mjs";

// State file under <markerDir>/.codex-pair/state/ (ADR-092).
export const BROKER_STATE_FILE = "broker.json";
export const BROKER_HEALTH_TIMEOUT_MS = 2000;
export const BROKER_SOCKET_PREFIX = "codex-pair-broker";

// Protocol version we target. Pinned so a codex CLI upgrade with breaking
// protocol changes is detected at handshake time rather than silently
// producing malformed requests. Verified empirically against codex-cli
// 0.130.0 via `codex app-server generate-json-schema`; ADR-093 documents
// the methods + notification stream we depend on.
export const BROKER_PROTOCOL_VERSION = "v2";

// JSON-RPC client → server methods codex-pair USES (subset of the 75
// available; see ADR-093). Pinning these here documents the contract and
// lets structural tests catch silent drift.
export const JSONRPC_METHODS = Object.freeze({
  INITIALIZE: "initialize",
  THREAD_START: "thread/start",
  TURN_START: "turn/start",
  TURN_INTERRUPT: "turn/interrupt",
  MODEL_LIST: "model/list", // used for health probe (cheap, no side effects)
});

// JSON-RPC server → client notifications codex-pair LISTENS for. Subset
// of the full event stream; we ignore the rest. `TURN_COMPLETED` is the
// terminal event that carries the final agent message (which carries the
// structured verdict when outputSchema is set).
export const JSONRPC_NOTIFICATIONS = Object.freeze({
  TURN_COMPLETED: "turn/completed",
  TURN_STARTED: "turn/started",
  ITEM_AGENT_MESSAGE_DELTA: "item/agentMessage/delta", // streaming text
  THREAD_TOKEN_USAGE_UPDATED: "thread/tokenUsage/updated", // cost tracking
});

// Build the JSON Schema we send as `outputSchema` on `turn/start`. Codex
// constrains the agent's final message to this shape per ADR-093, which
// means we get a structured verdict back without prose-parsing (per
// ADR-083's verdict contract). Centralized here so test fixtures and
// production code build the same schema.
// JSON Schema for `turn/start.outputSchema`. Harmonized in M3 to match
// the `parseConcernsJson` contract in `lib/parser.mjs` so the broker's
// structured output drops in to the existing per-edit hook flow without
// translation. Brainstorm-coordinator and codex-pair both flagged the
// prior mismatch (the original schema used `concerns: { high, med, low }`
// while the parser expects `findings: [{ severity, ... }]`).
//
// Shape matches `parser.mjs::parseConcernsJson`:
//   { verdict: "clean" } → no concerns
//   { verdict: "concerns", findings: [{ severity, body, file?, line?, recommendation? }] }
//
// Severity enum mirrors `lib/parser.mjs::SEVERITY_TO_BUCKET`:
//   "high" | "medium" | "low" (parser also accepts "med" but the codex
//   model emits the canonical "medium" — `med` is a legacy alias).
export function buildVerdictSchema() {
  return {
    type: "object",
    required: ["verdict"],
    additionalProperties: false,
    properties: {
      verdict: {
        type: "string",
        enum: ["clean", "concerns"],
        description: "Closed-set verdict (parser.mjs:parseConcernsJson contract).",
      },
      findings: {
        type: "array",
        description: "Required when verdict == 'concerns'. Empty array also accepted.",
        items: {
          type: "object",
          required: ["severity", "body"],
          additionalProperties: false,
          properties: {
            severity: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "ADR-077 severity ladder. 'medium' (canonical) — 'med' is a legacy alias.",
            },
            body: {
              type: "string",
              description: "The concern itself — what's wrong + why it matters + how to fix.",
            },
            title: {
              type: "string",
              description: "Optional short title rendered ahead of the file:line line.",
            },
            file: {
              type: "string",
              description: "File path (optional). Prepended to the rendered concern.",
            },
            line_start: {
              type: "integer",
              description:
                "Line number (optional). Multi-review M3 hotfix: parser.mjs reads `line_start`, not `line`. Rendered as ':<n>' suffix on file.",
            },
            recommendation: {
              type: "string",
              description: "Optional fix suggestion. Appended on a new line after body.",
            },
          },
        },
      },
    },
  };
}

// Single source of truth for "is the broker active for this project right
// now". Reads .codex-pair/state/broker.json and returns the broker descriptor
// (transport URL, pid, started_at, codex version, protocol version) or null
// if no broker is running. The hook's main flow checks this BEFORE the
// cache + inflight lock; a live broker bypasses both because the broker
// itself coordinates concurrent requests.
//
// The implementation is intentionally stubbed for v0.7.x Milestone 1.
// Returning null here causes every hook invocation to fall through to the
// existing per-edit spawn path — byte-identical behavior to pre-broker.
// M4: delegate to the lifecycle module's descriptor reader. The function
// signature is preserved for the stable contract; the body now returns
// a real descriptor when one exists (vs the M2 stub returning null
// unconditionally). isBrokerEnabled uses lifecycleReadBrokerDescriptor
// directly for the same purpose; this exported form is the public API
// per ADR-090.
export function readBrokerState(markerDir) {
  return lifecycleReadBrokerDescriptor(markerDir);
}

// Stable predicate the hook can call without knowing the broker mechanics.
// Returns true iff (a) ASK_CODEX_BROKER=1 in env, (b) readBrokerState
// returns a non-null descriptor, (c) the broker process is alive AND
// answered a health probe within BROKER_HEALTH_TIMEOUT_MS. Today (b) is
// stubbed to null, so this is always false.
// Tier 3 Milestone 4: implementation flipped from "always false" to a
// real check. Returns true iff:
//   1. ASK_CODEX_BROKER=1 in env (master switch — default off)
//   2. A valid descriptor exists at <markerDir>/.codex-pair/state/broker.json
//   3. The descriptor's protocolVersion matches BROKER_PROTOCOL_VERSION
//   4. The recorded pid is still alive (cheap process.kill(pid, 0))
//
// Per ADR-077 silent-on-error: any check that fails returns false; caller
// falls through to the existing per-edit spawn path. clearStaleBrokerState
// (called by SessionStart per ADR-090) keeps the descriptor honest between
// sessions; this check is the per-edit-hook's defense for the case where
// the broker died MID-SESSION.
export function isBrokerEnabled(markerDir) {
  if (process.env.ASK_CODEX_BROKER !== "1") return false;
  const state = lifecycleReadBrokerDescriptor(markerDir);
  if (!state) return false;
  if (state.protocolVersion !== BROKER_PROTOCOL_VERSION) return false;
  if (!lifecycleIsPidAlive(state.pid)) return false;
  return true;
}

// Path resolver for the per-marker-dir broker state file. Used by the
// SessionStart hook (writer) and the per-edit hook (reader).
export function brokerStatePath(markerDir, stateDir) {
  return join(markerDir, stateDir, BROKER_STATE_FILE);
}

// Stale-state cleanup helper. SessionStart calls this BEFORE launching a
// fresh broker; the per-edit hook MAY call it on startup as a belt-and-
// suspenders defense (but the SessionStart path is the contract per
// ADR-090). Returns "absent" | "live" | "stale".
//
// Implementation lives in `broker-lifecycle.mjs` to keep the descriptor-
// read + cleanup primitives co-located with the rest of the lifecycle
// orchestration. Re-exported here so consumers (the per-edit hook in M4,
// codex-pair-session.mjs in this PR) can import a single contract surface.
//
// The implementation needs `BROKER_PROTOCOL_VERSION` (this module's
// constant) — so the lifecycle module imports it from here, and we
// re-export the function below. This avoids a circular dep because
// broker-lifecycle.mjs already imports initializeBroker from this file;
// adding BROKER_PROTOCOL_VERSION to that import doesn't introduce a new
// cycle.
export { clearStaleBrokerState } from "./broker-lifecycle.mjs";

// M4: import the descriptor reader + pid-liveness helper into this module
// for isBrokerEnabled's per-edit-hook gating check. The one-way dep from
// broker.mjs → broker-lifecycle.mjs is fine: broker-lifecycle imports
// BROKER_PROTOCOL_VERSION + initializeBroker from this file, but only
// uses them inside function bodies (called after module init finishes),
// so the static-evaluation order is acyclic at the value-of-import level.
import {
  isPidAlive as lifecycleIsPidAlive,
  readBrokerDescriptorSync as lifecycleReadBrokerDescriptor,
} from "./broker-lifecycle.mjs";

// Open a transport connection to a running broker, perform the JSON-RPC
// `initialize` handshake, and return `{ connection, rpc, initializeResult }`.
// Caller owns connection lifetime — call `connection.close()` and stop
// using `rpc` when done. On any failure (transport error, handshake
// timeout, initialize rejection) this rejects; caller falls back to the
// per-edit spawn path per ADR-077.
//
// `clientInfo` is the InitializeParams.clientInfo object — codex-cli
// 0.130.0 requires `{ name, title, version }` (brainstorm-verified;
// ADR-093 protocol note). Callers should pass real plugin identity.
export async function initializeBroker(transportUrl, clientInfo, options = {}) {
  const { handshakeTimeoutMs = 5000, initializeTimeoutMs = 5000 } = options;
  const connection = await connectWebSocket(transportUrl, { handshakeTimeoutMs });
  const rpc = createRpcClient(connection, { defaultTimeoutMs: initializeTimeoutMs });
  try {
    const initializeResult = await rpc.request(
      JSONRPC_METHODS.INITIALIZE,
      { clientInfo },
      { timeoutMs: initializeTimeoutMs },
    );
    return { connection, rpc, initializeResult };
  } catch (err) {
    try {
      connection.close(1011, "initialize failed");
    } catch {
      // already torn down
    }
    throw err;
  }
}

// Health probe: open the transport, send `model/list` (idempotent, cheap),
// wait up to BROKER_HEALTH_TIMEOUT_MS for a response. Returns boolean.
// Never throws — callers in the hook path treat any failure as "broker
// unreachable, fall back to per-edit spawn" per ADR-077.
//
// `state` is the broker descriptor read from .codex-pair/state/broker.json
// (shape: `{ transportUrl, pid, codexVersion, protocolVersion, startedAt }`).
// Health probe uses transportUrl + initializes ad-hoc because the long-
// lived connection lives in the per-edit hook process, not here.
//
// Implementation note: model/list is preferred over `initialize` for the
// probe because the brainstorm verified that codex's `initialize` is
// metadata-rich + always-succeeds. `model/list` exercises the actual
// JSON-RPC plumbing AND validates that the broker can complete a real
// request — a stricter health signal.
export async function probeBrokerHealth(state) {
  if (!state || typeof state.transportUrl !== "string") return false;
  let connection;
  let rpc;
  try {
    connection = await connectWebSocket(state.transportUrl, {
      handshakeTimeoutMs: BROKER_HEALTH_TIMEOUT_MS,
    });
    rpc = createRpcClient(connection, { defaultTimeoutMs: BROKER_HEALTH_TIMEOUT_MS });
    // `model/list` requires the connection to have completed `initialize`
    // first per the codex protocol. The PROBE path opens a fresh
    // connection (no broker-side state shared with the long-lived hook
    // connection), so we must initialize here before model/list.
    await rpc.request(
      JSONRPC_METHODS.INITIALIZE,
      { clientInfo: { name: "codex-pair-health-probe", title: "codex-pair health probe", version: "0.0.0" } },
      { timeoutMs: BROKER_HEALTH_TIMEOUT_MS },
    );
    await rpc.request(JSONRPC_METHODS.MODEL_LIST, undefined, {
      timeoutMs: BROKER_HEALTH_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  } finally {
    if (connection && !connection.destroyed) {
      try {
        connection.close(1000, "probe done");
      } catch {
        // best-effort
      }
    }
  }
}

// Submit-review API. The hook calls this when isBrokerEnabled returns
// true. Today never reached. Real implementation (Milestone 3) performs
// a 3-step JSON-RPC dance per ADR-093:
//   1. `thread/start { ephemeral: true, cwd, baseInstructions, model,
//      approvalPolicy: "never", sandbox: <readonly> }`
//      → receives { thread: { id } }
//   2. `turn/start { threadId, input: [{type:"text", text: prompt}],
//      outputSchema: buildVerdictSchema(), effort: "high" }`
//      → receives { turn: { id } }
//   3. Listen on the JSON-RPC connection for `turn/completed`
//      notification; extract the final agentMessage; parse its JSON
//      content (constrained by outputSchema) into the verdict shape;
//      return same shape spawnCodex returns today.
//
// On abort signal: send `turn/interrupt { turnId }` and reject the
// promise. On timeout: same. On schema-violating output (rare per ADR-093
// risk acceptance): reject; caller falls through to per-edit spawn per
// ADR-077's silent-on-error contract.
//
// Args object shape (refined from ADR-090's `(state, prompt, options)`):
//   { state, baseInstructions, prompt, model, threadOptions, abortSignal }
// Returns: { agentMessage: string, tokenUsage: { ... }, durationMs: number }
// — mirrors the shape spawnCodex currently produces so the hook's main()
// integration is a one-line substitution.
// Tier 3 Milestone 3 implementation. Performs the JSON-RPC dance per
// ADR-093 + brainstorm-verified protocol facts:
//   1. `thread/start { ephemeral: true, cwd, baseInstructions, model,
//      approvalPolicy: "never", sandbox: "read-only" }`
//      → receives `{ thread: Thread }`. Pin `thread.id`.
//   2. Register `turn/completed` waiter BEFORE turn/start (race-safe).
//   3. `turn/start { threadId, input: [{type:"text", text: prompt}],
//      outputSchema: buildVerdictSchema(), effort: "high",
//      sandboxPolicy: { type: "readOnly", networkAccess: false } }`
//      → receives `{ turn: Turn }`. Pin `turn.id`.
//   4. Await `turn/completed` notification matching our threadId. Extract
//      the final agentMessage text via `turn.items.findLast(i =>
//      i.type === "agentMessage")?.text`.
//   5. On abort: send `turn/interrupt { threadId, turnId }` best-effort.
//   6. Return STRING (matches spawnCodex's return so the hook flow doesn't
//      need a translation layer).
//
// `args` shape (refined from ADR-090's `(state, prompt, options)`):
//   { connection, rpc, cwd, baseInstructions, prompt, model, timeoutMs,
//     abortSignal }
//
// Caller owns connection + rpc lifetime; submitReview does NOT close them.
// Failures map to thrown errors with `.code` matching the existing
// taggedError verdict set in codex-pair-watch.mjs (timeout, error,
// parse_failed) so the surrounding hook flow handles them uniformly.
// Wrap an rpc.request for the thread/start + turn/start dance so a
// transport-layer failure (request timeout, connection closed/errored) on a
// broker that handshook OK but then hung is tagged brokerFailure=true. Per
// ADR-077 a post-handshake broker hang must be a silent fallback to the
// per-edit spawn, but broker-rpc's timeout/close/error rejections are PLAIN
// Errors lacking that marker, so runCodexWithFallback would otherwise
// rethrow them as a hard verdict. broker-rpc rejects a transport failure with
// either a PLAIN Error (timeout / connection-closed → no `.code`) or the RAW
// socket error (transport "error" event → a STRING `.code` like ECONNRESET).
// Only a genuine JSON-RPC error RESPONSE carries a NUMERIC `.code` (broker-rpc
// sets it from env.error.code) — that's a real server-side verdict, not a
// broker outage. So we tag everything EXCEPT numeric-coded errors.
async function brokerRequest(rpc, method, params, timeoutMs, brokerPhase) {
  try {
    return await rpc.request(method, params, { timeoutMs });
  } catch (err) {
    if (err && typeof err === "object" && typeof err.code !== "number" && !err.brokerFailure) {
      err.verdict = "error";
      err.brokerFailure = true;
      err.brokerPhase = brokerPhase;
    }
    throw err;
  }
}

export async function submitReview(args) {
  const { rpc, connection, cwd, baseInstructions, prompt, model, timeoutMs = 60_000, abortSignal } = args;
  if (!rpc) throw new Error("submitReview: rpc client required");
  if (!connection) throw new Error("submitReview: connection required");
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error("submitReview: prompt required");
  }

  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());

  // 1. thread/start (ephemeral — codex auto-discards after the turn).
  // approvalPolicy: "never" is mandatory for the hook context (no user
  // available to approve interactive prompts). sandbox: "read-only" denies
  // file writes from the reviewer.
  const threadResp = await brokerRequest(
    rpc,
    JSONRPC_METHODS.THREAD_START,
    {
      ephemeral: true,
      cwd,
      baseInstructions,
      model,
      approvalPolicy: "never",
      sandbox: "read-only",
    },
    remaining(),
    "thread_start",
  );
  const threadId = threadResp?.thread?.id;
  if (typeof threadId !== "string") {
    // M4 brokerFailure discriminator: thread_start failures indicate the
    // broker is broken at the protocol layer. Hook falls back to spawnCodex.
    const err = new Error("submitReview: thread/start returned no thread.id");
    err.verdict = "error";
    err.brokerFailure = true;
    err.brokerPhase = "thread_start";
    throw err;
  }

  // 2. Register the turn/completed waiter BEFORE turn/start. Codex can
  // emit turn/completed between the turn/start dispatch and the listener
  // registration if we order them the other way around (brainstorm
  // Risk #1).
  const completionPromise = rpc.waitFor(
    JSONRPC_NOTIFICATIONS.TURN_COMPLETED,
    (n) => n.params?.threadId === threadId,
    remaining(),
  );

  // 3. turn/start. outputSchema constrains the agent's final message to
  // the parser-compatible shape (parser.mjs::parseConcernsJson).
  const turnResp = await brokerRequest(
    rpc,
    JSONRPC_METHODS.TURN_START,
    {
      threadId,
      input: [{ type: "text", text: prompt }],
      outputSchema: buildVerdictSchema(),
      effort: "high",
      // Belt-and-suspenders: also pin turn-level sandbox + deny network.
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    },
    remaining(),
    "turn_start",
  );
  const turnId = turnResp?.turn?.id;
  if (typeof turnId !== "string") {
    // M4 brokerFailure discriminator: turn_start failures = broker protocol
    // is broken. Hook falls back to spawnCodex.
    const err = new Error("submitReview: turn/start returned no turn.id");
    err.verdict = "error";
    err.brokerFailure = true;
    err.brokerPhase = "turn_start";
    throw err;
  }

  // 4. Wire cancellation. abortSignal abort → turn/interrupt + reject.
  let abortHandler = null;
  let interruptSent = false;
  // Multi-review M3 hotfix: track completion so a late abort (firing
  // AFTER completion resolves but BEFORE finally cleans up) doesn't
  // send a spurious turn/interrupt for an already-done turn.
  let completed = false;
  const abortPromise = abortSignal
    ? new Promise((_, reject) => {
        abortHandler = () => {
          // Early-return if we already got the completion. Closes the
          // abort-after-completion race window flagged in multi-review.
          if (completed) return;
          interruptSent = true;
          // Best-effort interrupt; don't await it on the abort path —
          // we want to reject the user-facing promise immediately.
          rpc.request(JSONRPC_METHODS.TURN_INTERRUPT, { threadId, turnId }, { timeoutMs: 2000 }).catch(() => {});
          // Multi-review M3 hotfix: use `verdict` not `code` — the
          // hook's verdictFromError reads err.verdict. "aborted" is
          // not in VERDICT_PREFIXES so map to "error".
          const err = new Error("submitReview: aborted");
          err.verdict = "error";
          err.aborted = true; // structured marker for callers who care
          reject(err);
        };
        if (abortSignal.aborted) abortHandler();
        else abortSignal.addEventListener("abort", abortHandler);
      })
    : null;

  // 5. Race the completion against the abort.
  let completion;
  try {
    completion = abortPromise ? await Promise.race([completionPromise, abortPromise]) : await completionPromise;
    completed = true;
  } catch (err) {
    // On timeout (waitFor rejects), send best-effort interrupt so we
    // don't leak a server-side turn. Multi-review M3 hotfix: use the
    // structured err.timeout marker from broker-rpc, not regex on message.
    if (!interruptSent && err && err.timeout === true) {
      rpc.request(JSONRPC_METHODS.TURN_INTERRUPT, { threadId, turnId }, { timeoutMs: 2000 }).catch(() => {});
      const wrapped = new Error("submitReview: turn timed out");
      wrapped.verdict = "timeout";
      wrapped.timeout = true;
      throw wrapped;
    }
    throw err;
  } finally {
    if (abortHandler && abortSignal) {
      abortSignal.removeEventListener("abort", abortHandler);
    }
    // If the abort handler already fired but we'd completed, it sent a
    // spurious interrupt and rejected an unawaited promise. The flag
    // above prevents that — abortHandler now early-returns if completed.
  }

  // 6. Extract the final agentMessage from `turn.items`. Brainstorm
  // confirmed multiple `agentMessage` items can appear (reasoning summaries
  // vs final answer); `findLast` picks the last/final one.
  // `completed` is read by the abortHandler closure to detect the
  // abort-after-completion race; biome won't strip it.
  const turn = completion?.params?.turn;
  if (!turn || !Array.isArray(turn.items)) {
    // M4: protocol-layer failure → brokerFailure → hook falls back.
    const err = new Error("submitReview: turn/completed missing turn.items");
    err.verdict = "parse_failed";
    err.brokerFailure = true;
    err.brokerPhase = "protocol";
    throw err;
  }
  if (turn.status === "failed" || turn.status === "interrupted") {
    const err = new Error(`submitReview: turn ${turn.status}${turn.error?.message ? ` — ${turn.error.message}` : ""}`);
    err.verdict = "error";
    throw err;
  }
  const finalMessage = turn.items.findLast?.((i) => i?.type === "agentMessage");
  if (!finalMessage || typeof finalMessage.text !== "string") {
    // M4: protocol-layer failure (broker spoke turn/completed but with no
    // agentMessage). Mark brokerFailure so hook falls back to spawnCodex —
    // this is a broker-broken state, not a real codex result.
    const err = new Error("submitReview: turn/completed has no agentMessage item");
    err.verdict = "parse_failed";
    err.brokerFailure = true;
    err.brokerPhase = "protocol";
    throw err;
  }
  return finalMessage.text;
}
