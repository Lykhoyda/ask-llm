// JSON-RPC 2.0 client layered on a `broker-transport.mjs` connection
// (ADR-090 + ADR-093 Milestone 2 PR 1). The transport emits WebSocket
// TEXT frames whose payloads are JSON-RPC envelopes; this module handles
// request/response correlation by `id`, per-request timeouts, server-
// pushed notifications, and graceful close.
//
// **Tolerance.** Brainstorm probing of the real `codex app-server`
// (codex-cli 0.130.0) found that responses lack the `"jsonrpc":"2.0"`
// discriminator (ADR-093 protocol note). This client accepts envelopes
// with OR without that field; it dispatches purely on the `id` and
// `method` properties.

// Auto-incrementing request id source. JSON-RPC permits any unique
// non-null id; integers are simplest. Not cryptographic — exposing the
// counter doesn't leak anything.
let nextId = 1;
function takeNextId() {
  const id = nextId;
  nextId = (nextId + 1) | 0; // wrap at 2^31 (effectively never)
  if (nextId <= 0) nextId = 1;
  return id;
}

// Create a JSON-RPC client over a connected `broker-transport.mjs`
// WebSocketConnection. The caller is responsible for `connection.close()`.
// This client manages the protocol layer on top, not the socket lifetime.
//
// Options:
//   - defaultTimeoutMs (number, default 30000): per-request budget.
//   - onNotification (function, default no-op): called with
//     `{ method, params }` for server-pushed notifications (envelopes
//     lacking an `id`).
//   - onProtocolError (function, default no-op): called when an inbound
//     text frame can't be parsed as JSON or has neither id nor method.
export function createRpcClient(connection, options = {}) {
  const { defaultTimeoutMs = 30000, onNotification = () => {}, onProtocolError = () => {} } = options;
  const pending = new Map(); // id -> { resolve, reject, timer }
  // Subscriber list for waitFor — each entry { method, predicate, resolve, reject, timer }.
  // M3 needs to attach a notification listener BEFORE dispatching `turn/start`
  // (race-safe per brainstorm Risk #1: server can emit `turn/completed` between
  // request-send and listener-install if registered after the send).
  const notificationSubscribers = new Set();
  let closed = false;

  connection.on("message", (text) => {
    let env;
    try {
      env = JSON.parse(text);
    } catch (err) {
      onProtocolError(new Error(`broker-rpc: malformed JSON from server: ${err?.message ?? String(err)}`));
      return;
    }
    if (env && typeof env === "object" && "id" in env && env.id != null) {
      const entry = pending.get(env.id);
      if (!entry) {
        // Late response after timeout, or an id we didn't send. Ignore;
        // surface as a soft protocol error for diagnostics.
        onProtocolError(new Error(`broker-rpc: response for unknown id ${env.id}`));
        return;
      }
      pending.delete(env.id);
      clearTimeout(entry.timer);
      if (env.error) {
        const err = new Error(env.error.message ?? `JSON-RPC error ${env.error.code ?? "?"}`);
        err.code = env.error.code;
        err.data = env.error.data;
        entry.reject(err);
      } else {
        entry.resolve(env.result);
      }
      return;
    }
    if (env && typeof env === "object" && typeof env.method === "string") {
      // Server-pushed notification (or a server-initiated request, which
      // codex-pair refuses since approvalPolicy:"never" — but pass it up
      // either way and let the caller decide).
      const notification = { method: env.method, params: env.params, id: env.id };
      // Dispatch to waitFor subscribers first — they capture by method+predicate.
      // Iterate a snapshot since resolved subscribers self-remove during dispatch.
      for (const sub of [...notificationSubscribers]) {
        if (sub.method === env.method) {
          try {
            if (!sub.predicate || sub.predicate(notification)) {
              notificationSubscribers.delete(sub);
              clearTimeout(sub.timer);
              sub.resolve(notification);
            }
          } catch (err) {
            notificationSubscribers.delete(sub);
            clearTimeout(sub.timer);
            sub.reject(err);
          }
        }
      }
      onNotification(notification);
      return;
    }
    onProtocolError(new Error(`broker-rpc: envelope has neither id nor method: ${text.slice(0, 120)}`));
  });

  connection.on("close", () => {
    closed = true;
    for (const [id, entry] of pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("broker-rpc: connection closed before response"));
      pending.delete(id);
    }
    // Also reject any notification waiters — they'll never fire post-close.
    for (const sub of notificationSubscribers) {
      clearTimeout(sub.timer);
      sub.reject(new Error("broker-rpc: connection closed before notification"));
    }
    notificationSubscribers.clear();
  });

  connection.on("error", (err) => {
    // Pending requests still time out via their own timers, but surface
    // transport errors immediately too.
    for (const [id, entry] of pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(err);
      pending.delete(id);
    }
    // Multi-review M3 hotfix: also reject notification waiters — some
    // Node transports emit "error" without a following "close", so the
    // close-handler cleanup wouldn't run otherwise and waitFor() would
    // hang until its own timeout. Surface the real transport error
    // immediately for diagnostics instead of a generic timeout.
    for (const sub of notificationSubscribers) {
      clearTimeout(sub.timer);
      sub.reject(err);
    }
    notificationSubscribers.clear();
  });

  return {
    request(method, params, opts = {}) {
      if (closed) return Promise.reject(new Error("broker-rpc: client is closed"));
      const id = takeNextId();
      const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
      const envelope = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`broker-rpc: timeout after ${timeoutMs}ms (method=${method}, id=${id})`));
        }, timeoutMs);
        timer.unref?.();
        pending.set(id, { resolve, reject, timer });
        try {
          connection.sendText(envelope);
        } catch (err) {
          pending.delete(id);
          clearTimeout(timer);
          reject(err);
        }
      });
    },
    notify(method, params) {
      // Notifications have no id and expect no response.
      if (closed) throw new Error("broker-rpc: client is closed");
      connection.sendText(JSON.stringify({ jsonrpc: "2.0", method, params }));
    },
    // Register a notification listener with a predicate. Returns a Promise
    // resolving to the matched notification, OR rejecting on timeout / close.
    // CRITICAL: call this BEFORE the request that triggers the notification
    // (per brainstorm Risk #1 — server can emit `turn/completed` between
    // request-send and listener-install if registered after the send).
    //
    // Usage in M3 submitReview:
    //   const waiter = rpc.waitFor("turn/completed", n => n.params?.threadId === ourThreadId, timeoutMs);
    //   await rpc.request("turn/start", { ... });
    //   const completion = await waiter;
    waitFor(method, predicate, timeoutMs) {
      if (closed) return Promise.reject(new Error("broker-rpc: client is closed"));
      let sub;
      const promise = new Promise((resolve, reject) => {
        sub = { method, predicate, resolve, reject, timer: null };
        sub.timer = setTimeout(() => {
          notificationSubscribers.delete(sub);
          // Multi-review M3 hotfix: attach a structured `.timeout = true`
          // marker so callers don't have to regex-match the message.
          const err = new Error(`broker-rpc: waitFor(${method}) timed out after ${timeoutMs}ms`);
          err.timeout = true;
          reject(err);
        }, timeoutMs);
        sub.timer.unref?.();
        notificationSubscribers.add(sub);
      });
      promise.cancel = () => {
        if (!notificationSubscribers.delete(sub)) return;
        clearTimeout(sub.timer);
        sub.resolve(null);
      };
      return promise;
    },
    get pendingCount() {
      return pending.size;
    },
    get closed() {
      return closed;
    },
  };
}

// Exports for tests
export const __testing__ = {
  resetIdCounter() {
    nextId = 1;
  },
};
