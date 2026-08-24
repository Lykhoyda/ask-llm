// WebSocket-over-net transport for the codex-pair broker (ADR-090 + ADR-093
// Milestone 2 PR 1). Minimal hand-rolled RFC 6455 client supporting both
// unix-domain-socket (`unix://`) and TCP (`ws://`) transports through one
// code path. Pure Node built-ins per ADR-078 — no `ws` package, no
// workspace imports.
//
// **Scope discipline.** This is the smallest subset of RFC 6455 that
// satisfies codex `app-server`'s usage:
//   - Single client connection, no multiplexing.
//   - TEXT opcode (0x1) for JSON-RPC frames, no BINARY, no fragmentation.
//   - Client masks all frames (RFC 6455 §5.3). Server does not.
//   - Auto-respond to server PING with PONG mirroring the payload.
//   - Send CLOSE (0x8) on `close()`, handle inbound CLOSE.
//   - No permessage-deflate or other extensions.
//   - No subprotocols.
//
// **Tolerance.** codex app-server's JSON-RPC responses observed in the
// wild lack the `"jsonrpc":"2.0"` discriminator (verified by brainstorm
// probing — see ADR-093 protocol notes). The JSON parsing here passes
// raw text up; the RPC layer in `broker-rpc.mjs` does the tolerant
// matching by id.

import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { connect } from "node:net";

// RFC 6455 frame opcodes we recognize.
const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

// RFC 6455 magic GUID for the Sec-WebSocket-Accept derivation (§4.2.2).
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Parse a transport URL into `net.connect` options. Supports:
//   unix:///absolute/path/to/socket
//   unix://relative/from/cwd
//   ws://host:port           — also accepts host without port (defaults 80)
// Returns `{ connectOptions, host, isUnix }`.
export function parseTransportUrl(url) {
  if (typeof url !== "string") {
    throw new TypeError(`broker-transport: transport URL must be string, got ${typeof url}`);
  }
  if (url.startsWith("unix://")) {
    const path = url.slice("unix://".length);
    if (!path) throw new Error(`broker-transport: unix:// URL has empty path`);
    return { connectOptions: { path }, host: "localhost", isUnix: true };
  }
  if (url.startsWith("ws://")) {
    const rest = url.slice("ws://".length);
    const slashIdx = rest.indexOf("/");
    const authority = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    const colonIdx = authority.lastIndexOf(":");
    const host = colonIdx === -1 ? authority : authority.slice(0, colonIdx);
    const port = colonIdx === -1 ? 80 : Number(authority.slice(colonIdx + 1));
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`broker-transport: ws:// URL has invalid port: ${authority}`);
    }
    return { connectOptions: { host, port }, host: authority, isUnix: false };
  }
  throw new Error(`broker-transport: unsupported transport URL scheme: ${url} (need unix:// or ws://)`);
}

// Build the HTTP/1.1 upgrade request bytes for a given parsed URL. The
// `Host:` header is required for the HTTP/1.1 framing even when the
// transport is a unix socket (it's not used for routing but the codex
// server's upgrade parser requires it). We send a fixed "localhost" for
// unix sockets and the authority for TCP.
function buildUpgradeRequest(host, secKey) {
  return [
    `GET / HTTP/1.1`,
    `Host: ${host}`,
    `Upgrade: websocket`,
    `Connection: Upgrade`,
    `Sec-WebSocket-Key: ${secKey}`,
    `Sec-WebSocket-Version: 13`,
    ``,
    ``,
  ].join("\r\n");
}

// Validate the server's upgrade response (RFC 6455 §4.1 step 4). The
// 101 status + Sec-WebSocket-Accept header derived from our Sec-WebSocket-Key
// are the mandatory checks. We ignore optional fields.
function validateUpgradeResponse(headerText, sentKey) {
  const lines = headerText.split("\r\n");
  if (!lines[0] || !/^HTTP\/1\.[01]\s+101\b/.test(lines[0])) {
    throw new Error(`broker-transport: upgrade rejected, status line: ${lines[0] ?? "(empty)"}`);
  }
  let accept = null;
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(":");
    if (colon === -1) continue;
    const name = lines[i].slice(0, colon).trim().toLowerCase();
    if (name === "sec-websocket-accept") {
      accept = lines[i].slice(colon + 1).trim();
      break;
    }
  }
  const expected = createHash("sha1")
    .update(sentKey + WS_GUID)
    .digest("base64");
  if (accept !== expected) {
    throw new Error(
      `broker-transport: Sec-WebSocket-Accept mismatch (got ${accept ?? "(missing)"}, expected ${expected})`,
    );
  }
}

// Encode a TEXT frame. Client frames MUST be masked per RFC 6455 §5.3.
// Returns a Buffer ready to write to the socket.
function encodeTextFrame(text) {
  const payload = Buffer.from(text, "utf-8");
  const mask = randomBytes(4);
  const masked = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];

  let lenBytes;
  if (payload.length < 126) {
    lenBytes = Buffer.from([0x80 | payload.length]); // MASK bit + 7-bit length
  } else if (payload.length < 0x10000) {
    lenBytes = Buffer.allocUnsafe(3);
    lenBytes[0] = 0x80 | 126;
    lenBytes.writeUInt16BE(payload.length, 1);
  } else {
    lenBytes = Buffer.allocUnsafe(9);
    lenBytes[0] = 0x80 | 127;
    // 64-bit big-endian. JS BigInt for >32-bit lengths; we cap at Node's
    // Buffer.allocUnsafe practical limit anyway.
    lenBytes.writeBigUInt64BE(BigInt(payload.length), 1);
  }

  return Buffer.concat([
    Buffer.from([0x80 | OPCODE_TEXT]), // FIN bit + TEXT opcode
    lenBytes,
    mask,
    masked,
  ]);
}

// Maximum control-frame payload per RFC 6455 §5.5 ("All control frames
// MUST have a payload length of 125 bytes or less"). The 7-bit length
// field in byte[1] would otherwise overflow into the extended-length
// encoding flags (126, 127). Both encoders below truncate to this cap
// to guarantee on-wire correctness.
const MAX_CONTROL_FRAME_PAYLOAD = 125;

// Encode a CLOSE frame with optional status code + reason. Client-masked.
// Reason is truncated as needed to keep total payload ≤ 125 bytes per
// RFC 6455 §5.5 (multi-review Finding #3 — previously silently corrupted
// frames if reason was ≥ 124 bytes).
function encodeCloseFrame(code = 1000, reason = "") {
  let reasonBuf = Buffer.from(reason, "utf-8");
  // 2 bytes for the status code + reason. Truncate reason if combined
  // would exceed the control-frame cap.
  if (2 + reasonBuf.length > MAX_CONTROL_FRAME_PAYLOAD) {
    reasonBuf = reasonBuf.slice(0, MAX_CONTROL_FRAME_PAYLOAD - 2);
  }
  const payload = Buffer.allocUnsafe(2 + reasonBuf.length);
  payload.writeUInt16BE(code, 0);
  reasonBuf.copy(payload, 2);
  const mask = randomBytes(4);
  const masked = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([Buffer.from([0x80 | OPCODE_CLOSE, 0x80 | payload.length]), mask, masked]);
}

// Encode a PONG frame echoing the server's PING payload. Client-masked.
// PING payload is truncated to 125 bytes (RFC 6455 §5.5) — a hostile or
// buggy server sending a > 125-byte PING would otherwise scramble our
// outgoing frame.
function encodePongFrame(payload) {
  const capped = payload.length > MAX_CONTROL_FRAME_PAYLOAD ? payload.slice(0, MAX_CONTROL_FRAME_PAYLOAD) : payload;
  const mask = randomBytes(4);
  const masked = Buffer.allocUnsafe(capped.length);
  for (let i = 0; i < capped.length; i++) masked[i] = capped[i] ^ mask[i % 4];
  return Buffer.concat([Buffer.from([0x80 | OPCODE_PONG, 0x80 | capped.length]), mask, masked]);
}

// Stateful frame parser. Accumulates incoming bytes and emits whole frames
// via `onFrame({ opcode, payload })`. Caller drains via `feed(chunk)`.
// Server→client frames are NOT masked per RFC 6455 §5.3, so we ignore
// the MASK bit on parse. On fatal protocol violations (fragmentation we
// don't support, illegal frame shapes) the parser flips into a "corrupted"
// state — no further frames are emitted, and onError is called once.
// The caller (connectWebSocket) destroys the socket so pending RPC
// requests reject via the close handler. This was a multi-review finding
// — the previous code did `continue` after fragmentation and the buffer
// state corrupted forever.
function createFrameParser(onFrame, onError) {
  let buf = Buffer.alloc(0);
  let corrupted = false;
  return (chunk) => {
    if (corrupted) return; // already reported fatal — discard further bytes
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const first = buf[0];
      const second = buf[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      let len = second & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return; // need more
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        // Cast BigInt to Number — control frames have len<126 anyway, and
        // for data frames we cap at safe-integer range. 2GB payload is far
        // larger than any conceivable RPC response.
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      // Per RFC 6455, server→client frames must NOT be masked (we'd see
      // bit 0x80 set on byte[1]). If we see it, the peer is buggy; just
      // skip the mask bytes if present.
      const maskBit = (second & 0x80) !== 0;
      if (maskBit) offset += 4;
      if (buf.length < offset + len) return; // need more
      if (!fin && opcode !== OPCODE_CONTINUATION) {
        // Fragmentation is not supported. Marking corrupted so subsequent
        // bytes are ignored; the connect handler destroys the socket.
        // codex doesn't fragment JSON-RPC frames in practice, so this
        // path is defensive against a buggy or hostile server.
        corrupted = true;
        buf = Buffer.alloc(0);
        onError(new Error(`broker-transport: fragmentation not supported (opcode=${opcode}) — connection terminating`));
        return;
      }
      const payload = buf.slice(offset, offset + len);
      buf = buf.slice(offset + len);
      onFrame({ opcode, payload });
    }
  };
}

// Top-level connector. Returns a Promise<WebSocketConnection> after a
// successful HTTP upgrade. The connection exposes `sendText(s)`,
// `close(code?, reason?)`, and event listeners `on("message", cb)` /
// `on("close", cb)` / `on("error", cb)`.
//
// **Timeout semantics.** Connect + upgrade must complete within
// `handshakeTimeoutMs` (default 5000). On timeout, the underlying socket
// is destroyed and the promise rejects. After upgrade success, the caller
// owns the connection's lifetime.
export async function connectWebSocket(transportUrl, options = {}) {
  const { handshakeTimeoutMs = 5000 } = options;
  const { connectOptions, host } = parseTransportUrl(transportUrl);

  return new Promise((resolve, reject) => {
    const socket = connect(connectOptions);
    const listeners = { message: [], close: [], error: [] };
    let upgraded = false;
    let headerBuf = Buffer.alloc(0);
    let parser = null;

    const timer = setTimeout(() => {
      if (!upgraded) {
        socket.destroy();
        reject(new Error(`broker-transport: handshake timeout after ${handshakeTimeoutMs}ms`));
      }
    }, handshakeTimeoutMs);
    timer.unref?.();

    const secKey = randomBytes(16).toString("base64");

    // Use `.on` not `.once` — codex-pair flagged that `.once` removes the
    // only error listener after the first emission. If a second error
    // fires post-upgrade (e.g., RST after CLOSE, or a TCP-level failure
    // mid-stream), it becomes unhandled and crashes the process. The
    // `if (!upgraded)` guard makes the pre-upgrade reject() idempotent
    // (reject is a no-op after the promise settles).
    socket.on("error", (err) => {
      if (!upgraded) {
        clearTimeout(timer);
        reject(err);
      } else {
        for (const cb of listeners.error) cb(err);
      }
    });

    // Send the HTTP/1.1 upgrade request once the TCP/UDS connection is
    // established. This was missing in the original M2 PR 1 implementation
    // — flagged by the multi-review (both Codex + Gemini caught it). Unit
    // tests mocked around connectWebSocket so the missing write was
    // invisible. The fixture-server test added in this hotfix exercises
    // the real upgrade path so this class of bug can't recur silently.
    socket.once("connect", () => {
      try {
        socket.write(buildUpgradeRequest(host, secKey));
      } catch (err) {
        if (!upgraded) {
          clearTimeout(timer);
          reject(err);
        }
      }
    });

    socket.once("close", () => {
      clearTimeout(timer);
      if (!upgraded) reject(new Error("broker-transport: socket closed before upgrade"));
      else for (const cb of listeners.close) cb();
    });

    socket.on("data", (chunk) => {
      if (upgraded) {
        parser(chunk);
        return;
      }
      headerBuf = Buffer.concat([headerBuf, chunk]);
      const end = headerBuf.indexOf("\r\n\r\n");
      if (end === -1) return;
      const headerText = headerBuf.slice(0, end).toString("utf-8");
      const tail = headerBuf.slice(end + 4);
      try {
        validateUpgradeResponse(headerText, secKey);
      } catch (err) {
        socket.destroy();
        clearTimeout(timer);
        reject(err);
        return;
      }
      upgraded = true;
      clearTimeout(timer);
      parser = createFrameParser(
        ({ opcode, payload }) => {
          if (opcode === OPCODE_TEXT) {
            const text = payload.toString("utf-8");
            for (const cb of listeners.message) cb(text);
          } else if (opcode === OPCODE_PING) {
            // Auto-respond with PONG mirroring the payload (RFC §5.5.2).
            socket.write(encodePongFrame(payload));
          } else if (opcode === OPCODE_CLOSE) {
            // Echo close + half-close (RFC §5.5.1).
            try {
              socket.write(encodeCloseFrame(1000, ""));
            } catch {
              // best-effort
            }
            socket.end();
          } else if (opcode === OPCODE_BINARY) {
            // codex doesn't send binary for JSON-RPC; ignore silently.
          }
          // PONG and CONTINUATION are no-ops here.
        },
        (err) => {
          for (const cb of listeners.error) cb(err);
          // Parser-level errors signal unrecoverable protocol corruption
          // (fragmentation, malformed framing). Destroy the socket so
          // pending RPC requests reject via the close handler. Multi-
          // review finding #4: previously the parser silently corrupted
          // its buffer state and kept "running" against garbage.
          try {
            socket.destroy();
          } catch {
            // best-effort
          }
        },
      );

      const conn = {
        sendText(text) {
          socket.write(encodeTextFrame(text));
        },
        close(code = 1000, reason = "") {
          try {
            socket.write(encodeCloseFrame(code, reason));
          } catch {
            // best-effort — caller treats close as fire-and-forget
          }
          socket.end();
        },
        on(event, cb) {
          if (!listeners[event]) throw new Error(`broker-transport: unknown event ${event}`);
          listeners[event].push(cb);
        },
        get destroyed() {
          return socket.destroyed;
        },
        // For tests / diagnostics
        _underlyingSocket() {
          return socket;
        },
      };

      // If the upgrade response had body bytes already buffered, feed them.
      if (tail.length > 0) parser(tail);

      resolve(conn);
    });
  });
}

// Exports for tests
export const __testing__ = {
  encodeTextFrame,
  encodeCloseFrame,
  encodePongFrame,
  createFrameParser,
  validateUpgradeResponse,
  buildUpgradeRequest,
  WS_GUID,
};
