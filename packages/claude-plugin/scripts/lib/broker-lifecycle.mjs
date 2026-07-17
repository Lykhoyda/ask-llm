// Broker lifecycle: spawn `codex app-server`, poll readiness, handshake,
// atomic descriptor write. SessionStart calls `bootstrapBroker`; SessionEnd
// calls `teardownBroker`. Stale-broker recovery (`clearStaleBrokerState`)
// lives in `broker.mjs` so the per-edit hook can also use it as a
// belt-and-suspenders check.
//
// Per ADR-090 + ADR-093 + the brainstorm-coordinator's verified findings:
// the broker uses RFC 6455 WebSocket framing on BOTH `unix://` and `ws://`
// transports; readiness is `initialize` round-trip success, not socket
// existence; descriptor must be written ATOMICALLY only after `initialize`
// succeeds (no partial-broker states observable from the hook side per
// ADR-077). Wall-clock budget enforced on the whole bootstrap; on
// exhaustion or any failure path, the spawned child is terminated and
// the hook exits 0 silently.
//
// Pure Node built-ins + relative `./broker-*.mjs` imports per ADR-078.

import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, openSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { connect as netConnect } from "node:net";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { BROKER_PROTOCOL_VERSION, initializeBroker } from "./broker.mjs";
import { terminateProcessTree, IS_WINDOWS } from "./process.mjs";
import { stateRoot } from "./state.mjs";

// Locks live alongside the broker descriptor. Per-marker-dir isolation is
// inherent because the parent path is `<markerDir>/.codex-pair/state/`.
const BROKER_LOCK_DIR = "broker.lock";
const BROKER_LOG_FILE = "broker.log";
const BROKER_SOCKET_PREFIX = "codex-pair-broker";
const BOOTSTRAP_BUDGET_MS_DEFAULT = 5000;
const SOCKET_POLL_INTERVAL_MS = 100;

// Choose the transport URL for this marker directory. POSIX: unix socket
// under `<markerDir>/.codex-pair/state/`, with sha256-of-markerDir suffix
// to prevent name collisions across symlinked project trees. Windows:
// TODO — codex CLI supports `ws://IP:PORT` but cross-platform port
// reservation has a known race (Brainstorm Risk #3). Punted to a follow-on
// PR; for Milestone 2 we throw on Windows and the hook treats it as a
// bootstrap failure (silent exit per ADR-077).
export function chooseTransport(markerDir) {
  if (IS_WINDOWS) {
    throw new Error("broker-lifecycle: Windows transport not implemented yet (see ADR-090)");
  }
  const hash = createHash("sha256").update(markerDir).digest("hex").slice(0, 8);
  const socketPath = join(stateRoot(markerDir), `${BROKER_SOCKET_PREFIX}.${hash}.sock`);
  return `unix://${socketPath}`;
}

// Path resolvers for the lifecycle's filesystem state.
export function brokerLockPath(markerDir) {
  return join(stateRoot(markerDir), BROKER_LOCK_DIR);
}

export function brokerLogPath(markerDir) {
  return join(stateRoot(markerDir), BROKER_LOG_FILE);
}

// Atomic lock via mkdir(2). The mkdir syscall is atomic across all POSIX
// filesystems we care about (and on Windows). On success, returns the
// lock path; on EEXIST, returns null (another SessionStart already
// holding the lock — caller should exit quietly).
export function acquireBrokerLock(markerDir) {
  const lockPath = brokerLockPath(markerDir);
  try {
    mkdirSync(stateRoot(markerDir), { recursive: true });
    mkdirSync(lockPath);
    return lockPath;
  } catch (err) {
    if (err && err.code === "EEXIST") return null;
    throw err;
  }
}

export function releaseBrokerLock(lockPath) {
  if (!lockPath) return;
  try {
    // Lock is a directory created by mkdirSync (so mkdir(2) acted as our
    // atomic primitive). To remove a directory we need recursive:true on
    // rmSync — recursive:false throws even with force:true (force only
    // suppresses ENOENT, not EISDIR).
    rmSync(lockPath, { recursive: true, force: true });
  } catch {
    // Best-effort. A stuck lock will be cleared by stale-recovery at
    // next SessionStart (Milestone 2 PR 3 / Milestone 4).
  }
}

// Poll the transport for reachability. Different probes per scheme:
//   - unix:// — check the socket file exists + try net.connect once
//   - ws://   — try net.connect to host:port
// Returns true on first reachable response, false after the budget. The
// caller still has to perform `initialize` separately — reachability is
// necessary but not sufficient for "broker is healthy" per ADR-093.
export async function pollSocketReachable(transportUrl, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const reachable = await probeOnce(transportUrl);
    if (reachable) return true;
    await sleep(SOCKET_POLL_INTERVAL_MS);
  }
  return false;
}

function probeOnce(transportUrl) {
  return new Promise((resolve) => {
    let connectOptions;
    if (transportUrl.startsWith("unix://")) {
      const path = transportUrl.slice("unix://".length);
      try {
        statSync(path);
      } catch {
        resolve(false);
        return;
      }
      connectOptions = { path };
    } else if (transportUrl.startsWith("ws://")) {
      const rest = transportUrl.slice("ws://".length);
      const slashIdx = rest.indexOf("/");
      const authority = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
      const colonIdx = authority.lastIndexOf(":");
      const host = colonIdx === -1 ? authority : authority.slice(0, colonIdx);
      const port = colonIdx === -1 ? 80 : Number(authority.slice(colonIdx + 1));
      connectOptions = { host, port };
    } else {
      resolve(false);
      return;
    }
    const sock = netConnect(connectOptions);
    const settle = (ok) => {
      sock.removeAllListeners();
      try {
        sock.destroy();
      } catch {}
      resolve(ok);
    };
    sock.once("connect", () => settle(true));
    sock.once("error", () => settle(false));
    sock.once("timeout", () => settle(false));
    sock.setTimeout(SOCKET_POLL_INTERVAL_MS);
  });
}

// Sleep helper. Previously unref'd the timer, which codex-pair flagged
// repeatedly in M2: a unref'd timer lets Node exit before the awaited
// promise resolves if no other ref holds the event loop open. Result:
// SessionStart could exit mid-bootstrap, orphaning the partially-spawned
// codex process. The bootstrap's wall-clock budget is enforced at the
// deadline-check call sites, NOT by relying on idle-exit semantics.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Spawn `codex app-server --listen <transport>` detached so it outlives
// SessionStart's process. stdio is redirected to broker.log (open via
// O_APPEND so multiple writers — unlikely but defensive — don't tear).
// Returns the spawned ChildProcess; caller is responsible for tracking
// the pid and writing it to the descriptor only after handshake succeeds.
export function spawnBroker(markerDir, transportUrl) {
  // Bug #5: the socket path is deterministic (sha256 of markerDir), so an
  // orphaned socket inode — left when a prior broker was killed AFTER
  // binding but BEFORE writing its descriptor — makes the next bind fail
  // with EADDRINUSE permanently (clearStaleBrokerState early-returns
  // "absent" with no descriptor to drive cleanup). Unlink any stale socket
  // at the deterministic path before binding. extractSafeSocketPath gates
  // the unlink to paths strictly under <markerDir>/.codex-pair/state/ so a
  // malformed transportUrl can never delete an arbitrary path.
  const stalePath = extractSafeSocketPath(transportUrl, markerDir);
  if (stalePath !== null) {
    try {
      unlinkSync(stalePath);
    } catch {
      // already gone (the common case) — fine
    }
  }
  const logFd = openSync(brokerLogPath(markerDir), "a");
  const child = spawn("codex", ["app-server", "--listen", transportUrl], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  // spawn() emits "error" asynchronously for ENOENT (codex not on PATH)
  // and similar dispatch failures. Without a listener, Node treats this
  // as an unhandled error and crashes the hook process — violating
  // ADR-077's silent-on-error contract. Codex-pair flagged this finding
  // repeatedly during M2; attaching a no-op listener catches the error
  // (bootstrapBroker's poll/initialize step will fail subsequently and
  // route through the silent-fallback path).
  child.on("error", () => {
    // best-effort; bootstrap's outer catch handles the resulting
    // poll/initialize failure
  });
  // detached + unref so SessionStart can exit cleanly without waiting
  // for the broker. The broker stays alive as a session-scoped daemon.
  child.unref();
  return child;
}

// Codex version detection. Best-effort: returns the version string or
// "unknown" if codex isn't on PATH or fails. Used in the descriptor for
// version-skew detection (stale-broker recovery, Milestone 4).
export function readCodexVersion() {
  try {
    const out = execFileSync("codex", ["--version"], { timeout: 2000, encoding: "utf-8" });
    return (out || "").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

// Atomic descriptor write via tmp+rename (ADR-086). Caller ensures
// stateRoot(markerDir) exists (acquireBrokerLock creates it).
export async function writeBrokerDescriptor(markerDir, descriptor) {
  const finalPath = join(stateRoot(markerDir), "broker.json");
  const tmpPath = `${finalPath}.tmp.${process.pid}`;
  await writeFile(tmpPath, JSON.stringify(descriptor, null, 2));
  await rename(tmpPath, finalPath);
  return finalPath;
}

export async function unlinkBrokerDescriptor(markerDir) {
  const finalPath = join(stateRoot(markerDir), "broker.json");
  try {
    await unlink(finalPath);
  } catch {
    // best-effort
  }
}

// Resolve the plugin version from package.json. Used in clientInfo.title
// and the descriptor. Falls back to "unknown" if the manifest can't be
// read (the bundled marketplace install ships package.json adjacent to
// scripts/).
let cachedPluginVersion = null;
export function readPluginVersion() {
  if (cachedPluginVersion) return cachedPluginVersion;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // scripts/lib/*.mjs → packages/claude-plugin/package.json
    const manifest = join(here, "..", "..", "package.json");
    // Use the static ESM import — the original M2 PR 2 code used
    // `require("node:fs")` which is undefined in ESM (.mjs files), so
    // every call to this function threw ReferenceError silently and
    // permanently returned "unknown". Multi-review caught it; the
    // bootstrap-descriptor test now asserts pluginVersion is not
    // "unknown" so this regression can't sneak in again.
    const text = readFileSync(manifest, "utf-8");
    cachedPluginVersion = (JSON.parse(text)?.version || "unknown").trim();
  } catch {
    cachedPluginVersion = "unknown";
  }
  return cachedPluginVersion;
}

// Full bootstrap orchestrator. Acquires lock, spawns broker, polls for
// socket reachability, performs initialize handshake, writes descriptor
// atomically. Enforces wall-clock budget. On ANY failure, terminates
// the spawned child + releases the lock + returns null (caller exits 0
// per ADR-077). On success, returns the descriptor object that was
// written + closes the initialize connection (long-lived RPC is the
// per-edit hook's responsibility, not SessionStart's).
//
// Options:
//   - budgetMs (default 5000) — total wall-clock budget for spawn+poll+
//     initialize. Exhaustion = treated as failure.
//   - injectDeps — testing hook to inject mocked spawn / initializeBroker
//     for unit tests. Real production calls leave this undefined.
export async function bootstrapBroker(markerDir, options = {}) {
  const { budgetMs = BOOTSTRAP_BUDGET_MS_DEFAULT, injectDeps } = options;
  const spawnFn = injectDeps?.spawnBroker ?? spawnBroker;
  const initFn = injectDeps?.initializeBroker ?? initializeBroker;
  const pollFn = injectDeps?.pollSocketReachable ?? pollSocketReachable;
  const versionFn = injectDeps?.readCodexVersion ?? readCodexVersion;

  const lockPath = acquireBrokerLock(markerDir);
  if (!lockPath) return null; // another SessionStart holds the lock

  const deadline = Date.now() + budgetMs;
  let child = null;
  let connection = null; // hoisted so the catch block can close on descriptor-write failure
  try {
    const transportUrl = chooseTransport(markerDir);
    child = spawnFn(markerDir, transportUrl);

    // Strict deadline enforcement. Previously used Math.max(100, ...) and
    // Math.max(500, ...) as floors — codex-pair repeatedly flagged that
    // these floors let bootstrap continue AFTER the wall-clock budget had
    // been exhausted (defeating the silent-fallback contract). The deadline
    // is authoritative; if it's already past, fail fast.
    const pollBudget = deadline - Date.now() - 1000;
    if (pollBudget <= 0) throw new Error("broker bootstrap budget exhausted before poll");
    const reachable = await pollFn(transportUrl, pollBudget);
    if (!reachable) throw new Error("broker did not become reachable within budget");

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("broker bootstrap budget exhausted before initialize");
    const clientInfo = {
      name: "codex-pair",
      title: `codex-pair plugin v${readPluginVersion()}`,
      version: readPluginVersion(),
    };
    const initResult = await initFn(transportUrl, clientInfo, {
      handshakeTimeoutMs: remaining,
      initializeTimeoutMs: remaining,
    });
    connection = initResult.connection;
    const initializeResult = initResult.initializeResult;

    const descriptor = {
      pid: child.pid,
      transportUrl,
      codexVersion: versionFn(),
      codexHome: initializeResult?.codexHome ?? null,
      // Use the constant rather than a hardcoded "v2" — codex-pair flagged
      // the drift risk: if BROKER_PROTOCOL_VERSION changes in broker.mjs
      // but this string isn't updated, stale-recovery would always treat
      // the descriptor as live (matching the literal "v2" string instead
      // of the new constant).
      protocolVersion: BROKER_PROTOCOL_VERSION,
      pluginVersion: readPluginVersion(),
      startedAt: new Date().toISOString(),
      logPath: brokerLogPath(markerDir),
    };
    await writeBrokerDescriptor(markerDir, descriptor);

    // Close the bootstrap connection — the per-edit hook opens its own
    // long-lived RPC connection (Milestone 4).
    try {
      connection.close(1000, "bootstrap done");
    } catch {
      // best-effort
    }

    return descriptor;
  } catch {
    // ADR-077 silent-on-error. Tear down the child (best-effort) and
    // signal failure to the caller via null return.
    // Close the bootstrap connection if it was opened — codex-pair
    // flagged that a descriptor-write failure would leak the connection
    // because the close-on-success path is BELOW writeBrokerDescriptor
    // but the catch never closed it. Hoisting + close-in-catch fixes the
    // leak.
    if (connection) {
      try {
        connection.close(1011, "bootstrap failed");
      } catch {}
    }
    if (child) {
      try {
        terminateProcessTree(child, "SIGTERM");
      } catch {}
    }
    return null;
  } finally {
    releaseBrokerLock(lockPath);
  }
}

// ──── SessionEnd teardown (M2 PR 3) ────────────────────────────────────

// Read the broker descriptor synchronously. Returns the parsed object
// or null on any error (missing, malformed, unreadable). Used by
// teardownBroker AND by the per-edit hook's readBrokerState lookup.
export function readBrokerDescriptorSync(markerDir) {
  const descPath = join(stateRoot(markerDir), "broker.json");
  try {
    const text = readFileSync(descPath, "utf-8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.pid !== "number" || typeof parsed.transportUrl !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

// Best-effort liveness check on a recorded pid. POSIX uses `process.kill(pid, 0)`
// which sends a no-op signal — succeeds if the pid exists AND we have
// permission; fails (throws ESRCH) if the process is gone. Windows lacks
// this — the brainstorm flagged this as a follow-on; for M2 we treat
// Windows pids as "always live" so we send SIGTERM unconditionally on
// the Windows path (terminateProcessTree handles the cross-platform kill).
export function isPidAlive(pid) {
  if (typeof pid !== "number" || pid <= 0) return false;
  if (IS_WINDOWS) return true; // best-effort; rely on terminateProcessTree
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process. EPERM = process exists but we don't own
    // it (rare for our own-spawned broker but possible across user
    // switches); treat as "live" since we can't safely conclude dead.
    if (err && err.code === "EPERM") return true;
    return false;
  }
}

// Send SIGTERM, poll for exit, escalate to terminateProcessTree if the
// process is still alive after the grace period. Returns boolean (was
// the pid actually live before we killed it).
async function killPidGracefully(pid, graceMs) {
  if (!isPidAlive(pid)) return false;
  try {
    if (IS_WINDOWS) {
      // Windows: no graceful SIGTERM equivalent — go straight to taskkill.
      // Pass a minimal ChildProcess-shaped object that terminateProcessTree
      // recognizes.
      terminateProcessTree({ pid, killed: false, exitCode: null }, "SIGTERM");
      return true;
    }
    // POSIX: SIGTERM the process group (`-pid` requires the spawn was
    // detached, which bootstrapBroker enforces).
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Group gone — try direct pid signal.
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        return false;
      }
    }
    // Poll for exit
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      if (!isPidAlive(pid)) return true;
      await sleep(50);
    }
    // Still alive — escalate to SIGKILL via terminateProcessTree
    terminateProcessTree({ pid, killed: false, exitCode: null }, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

// Unlink the unix socket file alongside descriptor + lock. Only meaningful
// on POSIX; on Windows the WS transport doesn't leave a file. Caller
// must supply markerDir so we can validate the socket path is rooted
// under the marker's state directory (defense against a tampered
// descriptor.json pointing the unlink at an arbitrary path).
async function unlinkTransportArtifact(transportUrl, markerDir) {
  const safePath = extractSafeSocketPath(transportUrl, markerDir);
  if (safePath === null) return;
  try {
    await unlink(safePath);
  } catch {
    // already gone — fine
  }
}

// Stale-state cleanup. Reads broker.json; if any "stale" condition holds
// (pid dead, recorded protocol-version mismatch, unix socket missing),
// unlinks the descriptor + socket. Returns "absent" | "live" | "stale".
// SessionStart calls this BEFORE bootstrapBroker to recover from prior
// crashes; per-edit hook MAY call it as belt-and-suspenders defense.
// Re-exported from broker.mjs so consumers import one contract surface.
export function clearStaleBrokerState(markerDir) {
  const descriptor = readBrokerDescriptorSync(markerDir);
  if (!descriptor) return "absent";
  const alive = isPidAlive(descriptor.pid);
  const protoOk = descriptor.protocolVersion === BROKER_PROTOCOL_VERSION;
  // Transport-scheme dispatch — codex-pair flagged that the original code
  // treated UNKNOWN schemes (http://, junk, missing) as live because
  // extractSafeSocketPath returned null which left socketOk = true
  // (initialized). The correct logic distinguishes:
  //   - unix:// inside markerDir/state  → check socket file exists
  //   - unix:// outside markerDir/state → STALE (tampered descriptor)
  //   - ws://anything                   → assume live; per-edit probe validates
  //   - unknown / non-string            → STALE (junk descriptor)
  let socketOk;
  // Hoist sockPath so the cleanup block can reference it; only the unix
  // branch sets it to a real path, other branches leave it null.
  let sockPath = null;
  if (typeof descriptor.transportUrl !== "string") {
    socketOk = false;
  } else if (descriptor.transportUrl.startsWith("unix://")) {
    sockPath = extractSafeSocketPath(descriptor.transportUrl, markerDir);
    if (sockPath === null) {
      socketOk = false; // unix:// outside bounds — descriptor was tampered
    } else {
      try {
        statSync(sockPath);
        socketOk = true;
      } catch {
        socketOk = false;
      }
    }
  } else if (descriptor.transportUrl.startsWith("ws://")) {
    socketOk = true; // assume live; per-edit probeBrokerHealth validates
  } else {
    socketOk = false; // unrecognized scheme
  }
  if (alive && protoOk && socketOk) return "live";
  // Stale — clean up. Best-effort; failures are silent per ADR-077.
  try {
    unlinkSync(join(stateRoot(markerDir), "broker.json"));
  } catch {}
  if (sockPath !== null) {
    try {
      unlinkSync(sockPath);
    } catch {}
  }
  return "stale";
}

// Path-safety: validate that a unix:// socket path resolves under the
// markerDir's state root before we agree to stat or unlink it. Per the
// multi-review (Gemini Finding #4), a hostile or stale broker.json could
// otherwise direct us to unlink arbitrary paths the user has write
// permission to. Returns the safe socket path or null if invalid /
// non-unix / outside-bounds.
function extractSafeSocketPath(transportUrl, markerDir) {
  if (typeof transportUrl !== "string" || !transportUrl.startsWith("unix://")) {
    return null;
  }
  const sockPath = transportUrl.slice("unix://".length);
  if (!sockPath) return null;
  const resolvedSock = resolvePath(sockPath);
  const resolvedRoot = resolvePath(stateRoot(markerDir));
  // Path must be exactly the state root or strictly nested under it.
  // The boundary check guards against `/foo/bar/state-evil/x` matching
  // `/foo/bar/state` via a substring prefix.
  if (resolvedSock === resolvedRoot) return null; // can't unlink the root itself
  if (resolvedSock.startsWith(`${resolvedRoot}/`)) return resolvedSock;
  return null;
}

// SessionEnd orchestrator. Reads the descriptor, signals the broker pid
// to exit gracefully, terminateProcessTree if it doesn't, and cleans up
// the descriptor + socket + lock. Always exits successfully — ADR-077.
//
// Options:
//   - graceMs (default 1500) — how long to wait for SIGTERM to land
//     before escalating to SIGKILL.
//   - injectDeps — { killPid, unlinkSock } for testing.
export async function teardownBroker(markerDir, options = {}) {
  const { graceMs = 1500, injectDeps } = options;
  const killFn = injectDeps?.killPid ?? killPidGracefully;
  const unlinkSockFn = injectDeps?.unlinkSock ?? unlinkTransportArtifact;

  const descriptor = readBrokerDescriptorSync(markerDir);
  if (!descriptor) {
    // No descriptor — nothing to tear down. But still try to clean up
    // any stray lock from a crashed-mid-bootstrap SessionStart.
    releaseBrokerLock(brokerLockPath(markerDir));
    return null;
  }
  try {
    await killFn(descriptor.pid, graceMs);
  } catch {
    // best-effort
  }
  try {
    await unlinkSockFn(descriptor.transportUrl, markerDir);
  } catch {
    // best-effort
  }
  await unlinkBrokerDescriptor(markerDir);
  releaseBrokerLock(brokerLockPath(markerDir));
  return descriptor;
}

// Test-only exports
export const __testing__ = {
  BROKER_LOCK_DIR,
  BROKER_LOG_FILE,
  BROKER_SOCKET_PREFIX,
  BOOTSTRAP_BUDGET_MS_DEFAULT,
  isPidAlive,
  killPidGracefully,
  unlinkTransportArtifact,
};
