// Codex app-server broker for codex-pair (ADR-090, ADR-093, ADR-166).
// Unavailable or incompatible brokers fall back to per-edit codex exec.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrokerDescriptor } from "./broker-lifecycle.ts";
import { createRpcClient, type RpcClient, type RpcClientOptions, type RpcError } from "./broker-rpc.ts";
import { connectWebSocket, type WebSocketConnection } from "./broker-transport.ts";
import { parseFrontmatter } from "./frontmatter.ts";

export interface ClientInfo {
  name: string;
  title: string;
  version: string;
}

export interface InitializeResult {
  codexHome?: unknown;
  [key: string]: unknown;
}

export interface BrokerSession {
  connection: WebSocketConnection;
  rpc: RpcClient;
  initializeResult: InitializeResult;
}

export type BrokerError = RpcError & {
  verdict?: string;
  brokerFailure?: boolean;
  brokerPhase?: string;
  aborted?: boolean;
};

interface TurnItem {
  type?: string;
  text?: unknown;
}

interface TurnPayload {
  status?: string;
  error?: { message?: string };
  items?: TurnItem[];
}

export interface SubmitReviewArgs {
  rpc: RpcClient;
  connection: WebSocketConnection;
  cwd: string;
  baseInstructions: string;
  prompt: string;
  model: string;
  effort?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

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

// Strict structured output requires every property; nullable fields remain optional in meaning.
export function buildVerdictSchema() {
  return {
    type: "object",
    required: ["verdict", "findings"],
    additionalProperties: false,
    properties: {
      verdict: {
        type: "string",
        enum: ["clean", "concerns"],
        description: "Closed-set verdict (parser.mjs:parseConcernsJson contract).",
      },
      findings: {
        type: "array",
        description: "Use an empty array when verdict is clean.",
        items: {
          type: "object",
          required: ["severity", "body", "title", "file", "line_start", "recommendation"],
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
              type: ["string", "null"],
              description: "Optional short title rendered ahead of the file:line line.",
            },
            file: {
              type: ["string", "null"],
              description: "File path (optional). Prepended to the rendered concern.",
            },
            line_start: {
              type: ["integer", "null"],
              description:
                "Line number (optional). Multi-review M3 hotfix: parser.mjs reads `line_start`, not `line`. Rendered as ':<n>' suffix on file.",
            },
            recommendation: {
              type: ["string", "null"],
              description: "Optional fix suggestion. Appended on a new line after body.",
            },
          },
        },
      },
    },
  };
}

// Read the session broker descriptor; callers validate it before use.
export function readBrokerState(markerDir: string): BrokerDescriptor | null {
  return lifecycleReadBrokerDescriptor(markerDir);
}

export function resolveBrokerPreference(markerDir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ASK_CODEX_BROKER === "0") return false;
  try {
    const marker = readFileSync(join(markerDir, ".codex-pair", "context.md"), "utf8");
    return (parseFrontmatter(marker).frontmatter as Record<string, unknown>).broker !== false;
  } catch {
    return false;
  }
}

export function isBrokerEnabled(markerDir: string): boolean {
  if (!resolveBrokerPreference(markerDir)) return false;
  const state = lifecycleReadBrokerDescriptor(markerDir);
  if (!state) return false;
  if (!isIsolatedBrokerHome(state.isolatedHome)) return false;
  if (state.protocolVersion !== BROKER_PROTOCOL_VERSION) return false;
  if (!lifecycleIsPidAlive(state.pid)) return false;
  return true;
}

// Path resolver for the per-marker-dir broker state file. Used by the
// SessionStart hook (writer) and the per-edit hook (reader).
export function brokerStatePath(markerDir: string, stateDir: string): string {
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
export { clearStaleBrokerState } from "./broker-lifecycle.ts";

// M4: import the descriptor reader + pid-liveness helper into this module
// for isBrokerEnabled's per-edit-hook gating check. The one-way dep from
// broker.mjs → broker-lifecycle.mjs is fine: broker-lifecycle imports
// BROKER_PROTOCOL_VERSION + initializeBroker from this file, but only
// uses them inside function bodies (called after module init finishes),
// so the static-evaluation order is acyclic at the value-of-import level.
import {
  isIsolatedBrokerHome,
  isPidAlive as lifecycleIsPidAlive,
  readBrokerDescriptorSync as lifecycleReadBrokerDescriptor,
} from "./broker-lifecycle.ts";

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
export async function initializeBroker(
  transportUrl: string,
  clientInfo: ClientInfo,
  options: {
    handshakeTimeoutMs?: number;
    initializeTimeoutMs?: number;
    connectWebSocket?: (url: string, options: { handshakeTimeoutMs?: number }) => Promise<WebSocketConnection>;
    createRpcClient?: (connection: WebSocketConnection, options: RpcClientOptions) => RpcClient;
  } = {},
): Promise<BrokerSession> {
  const { handshakeTimeoutMs = 5000, initializeTimeoutMs = 5000 } = options;
  const connection = await (options.connectWebSocket ?? connectWebSocket)(transportUrl, { handshakeTimeoutMs });
  const rpc = (options.createRpcClient ?? createRpcClient)(connection, { defaultTimeoutMs: initializeTimeoutMs });
  try {
    const initializeResult = await rpc.request<InitializeResult>(
      JSONRPC_METHODS.INITIALIZE,
      { clientInfo },
      { timeoutMs: initializeTimeoutMs },
    );
    rpc.notify("initialized", {});
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
export async function probeBrokerHealth(state: { transportUrl?: unknown } | null | undefined): Promise<boolean> {
  if (!state || typeof state.transportUrl !== "string") return false;
  let connection: WebSocketConnection | undefined;
  let rpc: RpcClient;
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
    rpc.notify("initialized", {});
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
//      outputSchema: buildVerdictSchema(), effort: "medium" }`
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
//      outputSchema: buildVerdictSchema(), effort: "medium",
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
// Numeric JSON-RPC errors are server verdicts unless they reject the protocol.
async function brokerRequest<T>(
  rpc: RpcClient,
  method: string,
  params: unknown,
  timeoutMs: number,
  brokerPhase: string,
): Promise<T> {
  try {
    return await rpc.request<T>(method, params, { timeoutMs });
  } catch (caught) {
    const err = caught as BrokerError;
    const protocolRejection = [-32600, -32601, -32602].includes(err?.code as number);
    if (err && typeof err === "object" && (typeof err.code !== "number" || protocolRejection) && !err.brokerFailure) {
      err.verdict = "error";
      err.brokerFailure = true;
      err.brokerPhase = protocolRejection ? "protocol" : brokerPhase;
    }
    throw err;
  }
}

export async function submitReview(args: SubmitReviewArgs): Promise<string> {
  const { rpc, connection, cwd, baseInstructions, prompt, model, timeoutMs = 60_000, abortSignal } = args;
  const effort = args.effort ?? "medium";
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
  const threadResp = await brokerRequest<{ thread?: { id?: unknown } }>(
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
    const err: BrokerError = new Error("submitReview: thread/start returned no thread.id");
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
  completionPromise.catch(() => {});
  let completion: Awaited<typeof completionPromise> | undefined;
  try {
    // 3. turn/start. outputSchema constrains the agent's final message to
    // the parser-compatible shape (parser.mjs::parseConcernsJson).
    const turnResp = await brokerRequest<{ turn?: { id?: unknown } }>(
      rpc,
      JSONRPC_METHODS.TURN_START,
      {
        threadId,
        input: [{ type: "text", text: prompt }],
        outputSchema: buildVerdictSchema(),
        effort,
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
      const err: BrokerError = new Error("submitReview: turn/start returned no turn.id");
      err.verdict = "error";
      err.brokerFailure = true;
      err.brokerPhase = "turn_start";
      throw err;
    }

    // 4. Wire cancellation. abortSignal abort → turn/interrupt + reject.
    let abortHandler: (() => void) | null = null;
    let interruptSent = false;
    // Multi-review M3 hotfix: track completion so a late abort (firing
    // AFTER completion resolves but BEFORE finally cleans up) doesn't
    // send a spurious turn/interrupt for an already-done turn.
    let completed = false;
    const abortPromise = abortSignal
      ? new Promise<never>((_, reject) => {
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
            const err: BrokerError = new Error("submitReview: aborted");
            err.verdict = "error";
            err.aborted = true; // structured marker for callers who care
            reject(err);
          };
          if (abortSignal.aborted) abortHandler();
          else abortSignal.addEventListener("abort", abortHandler);
        })
      : null;

    // 5. Race the completion against the abort.
    try {
      completion = abortPromise ? await Promise.race([completionPromise, abortPromise]) : await completionPromise;
      completed = true;
    } catch (caught) {
      const err = caught as BrokerError;
      // On timeout (waitFor rejects), send best-effort interrupt so we
      // don't leak a server-side turn. Multi-review M3 hotfix: use the
      // structured err.timeout marker from broker-rpc, not regex on message.
      if (!interruptSent && err && err.timeout === true) {
        rpc.request(JSONRPC_METHODS.TURN_INTERRUPT, { threadId, turnId }, { timeoutMs: 2000 }).catch(() => {});
        const wrapped: BrokerError = new Error("submitReview: turn timed out");
        wrapped.verdict = "timeout";
        wrapped.timeout = true;
        wrapped.brokerFailure = true;
        wrapped.brokerPhase = "turn_completion";
        throw wrapped;
      }
      if (err && typeof err === "object" && !err.aborted) {
        err.brokerFailure = true;
        err.brokerPhase = "turn_completion";
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
  } finally {
    completionPromise.cancel?.();
  }

  // 6. Extract the final agentMessage from `turn.items`. Brainstorm
  // confirmed multiple `agentMessage` items can appear (reasoning summaries
  // vs final answer); `findLast` picks the last/final one.
  // `completed` is read by the abortHandler closure to detect the
  // abort-after-completion race; biome won't strip it.
  const turn = completion?.params?.turn as TurnPayload | undefined;
  if (!turn || !Array.isArray(turn.items)) {
    // M4: protocol-layer failure → brokerFailure → hook falls back.
    const err: BrokerError = new Error("submitReview: turn/completed missing turn.items");
    err.verdict = "parse_failed";
    err.brokerFailure = true;
    err.brokerPhase = "protocol";
    throw err;
  }
  if (turn.status === "failed" || turn.status === "interrupted") {
    const err: BrokerError = new Error(
      `submitReview: turn ${turn.status}${turn.error?.message ? ` — ${turn.error.message}` : ""}`,
    );
    err.verdict = "error";
    if (
      turn.status === "failed" &&
      /invalid_json_schema|unsupported method|method not found|invalid params/i.test(turn.error?.message ?? "")
    ) {
      err.brokerFailure = true;
      err.brokerPhase = "protocol";
    }
    throw err;
  }
  const finalMessage = turn.items.findLast?.((i: TurnItem) => i?.type === "agentMessage");
  if (!finalMessage || typeof finalMessage.text !== "string") {
    // M4: protocol-layer failure (broker spoke turn/completed but with no
    // agentMessage). Mark brokerFailure so hook falls back to spawnCodex —
    // this is a broker-broken state, not a real codex result.
    const err: BrokerError = new Error("submitReview: turn/completed has no agentMessage item");
    err.verdict = "parse_failed";
    err.brokerFailure = true;
    err.brokerPhase = "protocol";
    throw err;
  }
  return finalMessage.text;
}
