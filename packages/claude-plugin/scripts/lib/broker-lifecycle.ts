// Broker lifecycle: spawn `codex app-server`, poll readiness, handshake,
// atomic descriptor write. SessionStart calls `bootstrapBroker`; SessionEnd
// calls `teardownBroker`. Stale-broker recovery (`clearStaleBrokerState`)
// lives in `broker.ts` so the per-edit hook can also use it as a
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

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { type NetConnectOpts, connect as netConnect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BROKER_PROTOCOL_VERSION, type BrokerSession, type ClientInfo, initializeBroker } from "./broker.ts";
import { IS_WINDOWS, terminateProcessTree } from "./process.mjs";
import { stateRoot } from "./state.mjs";

export interface BrokerDescriptor {
  pid: number;
  transportUrl: string;
  codexVersion?: string;
  codexHome?: string | null;
  isolatedHome?: string;
  sessionId?: string | null;
  protocolVersion?: string;
  pluginVersion?: string;
  startedAt?: string;
  logPath?: string;
}

interface BootstrapDeps {
  spawnBroker?: (markerDir: string, transportUrl: string, isolatedHome: string) => ChildProcess;
  initializeBroker?: (
    transportUrl: string,
    clientInfo: ClientInfo,
    options: { handshakeTimeoutMs?: number; initializeTimeoutMs?: number },
  ) => Promise<BrokerSession>;
  pollSocketReachable?: (transportUrl: string, budgetMs: number) => Promise<boolean>;
  readCodexVersion?: () => string;
  isRecordedBroker?: (descriptor: BrokerDescriptor) => boolean;
  killPid?: (pid: number, graceMs: number) => Promise<boolean>;
  unlinkSock?: (transportUrl: string, markerDir: string) => Promise<void>;
}

export interface BootstrapOptions {
  budgetMs?: number;
  injectDeps?: BootstrapDeps;
  sessionId?: string;
  sourceHome?: string;
}

export interface TeardownOptions {
  graceMs?: number;
  injectDeps?: BootstrapDeps;
  lockHeld?: boolean;
  sessionId?: string;
}

// Locks live alongside the broker descriptor. Per-marker-dir isolation is
// inherent because the parent path is `<markerDir>/.codex-pair/state/`.
const BROKER_LOCK_DIR = "broker.lock";
const LOCK_OWNER_FILE = "owner.json";
const LOCK_SPAWN_FILE = "spawn.json";
// Far longer than a bootstrap (5s budget) or teardown (1.5s grace) can hold the lock.
const LOCK_STALE_MS = 30_000;
const BROKER_LOG_FILE = "broker.log";
const BROKER_SOCKET_FILE = "broker.sock";
// macOS sun_path is 104 bytes including the terminator; Linux allows 108.
const MAX_UNIX_SOCKET_PATH_BYTES = 103;
const BOOTSTRAP_BUDGET_MS_DEFAULT = 5000;
const SOCKET_POLL_INTERVAL_MS = 100;
const ISOLATED_HOME_PREFIX = "codex-pair-broker-";
const BROKER_OWNER_TTL_MS = 24 * 60 * 60 * 1000;

export function createIsolatedBrokerHome(options: { sourceHome?: string; tempRoot?: string } = {}): string {
  const sourceHome = options.sourceHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const home = mkdtempSync(join(options.tempRoot ?? tmpdir(), ISOLATED_HOME_PREFIX));
  try {
    chmodSync(home, 0o700);
    const auth = join(sourceHome, "auth.json");
    if (existsSync(auth)) symlinkSync(realpathSync(auth), join(home, "auth.json"));
    writeFileSync(join(home, "config.toml"), "[features]\napps = false\n", { mode: 0o600 });
    return home;
  } catch (error) {
    rmSync(home, { recursive: true, force: true });
    throw error;
  }
}

export function isIsolatedBrokerHome(home: unknown): home is string {
  if (typeof home !== "string") return false;
  try {
    const actual = realpathSync(home);
    const tempRoot = realpathSync(tmpdir());
    return (
      basename(actual).startsWith(ISOLATED_HOME_PREFIX) &&
      actual.startsWith(`${tempRoot}${sep}`) &&
      (statSync(actual).mode & 0o777) === 0o700
    );
  } catch {
    return false;
  }
}

export function removeIsolatedBrokerHome(home: unknown): void {
  if (isIsolatedBrokerHome(home)) rmSync(home, { recursive: true, force: true });
}

// The socket lives in the private broker home so its path stays short however deep the project is.
export function chooseTransport(isolatedHome: string): string {
  if (IS_WINDOWS) {
    throw new Error("broker-lifecycle: Windows transport not implemented yet (see ADR-090)");
  }
  const socketPath = join(isolatedHome, BROKER_SOCKET_FILE);
  if (Buffer.byteLength(socketPath) > MAX_UNIX_SOCKET_PATH_BYTES) {
    throw new Error(`broker-lifecycle: socket path exceeds ${MAX_UNIX_SOCKET_PATH_BYTES} bytes`);
  }
  return `unix://${socketPath}`;
}

// Path resolvers for the lifecycle's filesystem state.
export function brokerLockPath(markerDir: string): string {
  return join(stateRoot(markerDir), BROKER_LOCK_DIR);
}

export function brokerLogPath(markerDir: string): string {
  return join(stateRoot(markerDir), BROKER_LOG_FILE);
}

// Atomic lock via mkdir(2). A live holder makes this return null; a holder that died (for
// example a SessionStart killed mid-bootstrap) is reclaimed along with anything it spawned.
export function acquireBrokerLock(markerDir: string): string | null {
  const lockPath = brokerLockPath(markerDir);
  mkdirSync(stateRoot(markerDir), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lockPath);
      writeFileSync(join(lockPath, LOCK_OWNER_FILE), JSON.stringify({ pid: process.pid, at: Date.now() }));
      return lockPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
      if (attempt > 0 || !reclaimAbandonedLock(lockPath)) return null;
    }
  }
  return null;
}

function readLockFile(lockPath: string, file: string): string | null {
  try {
    return readFileSync(join(lockPath, file), "utf-8");
  } catch {
    return null;
  }
}

// The rename hands the abandoned lock to exactly one reclaimer; if what it moved is not the lock it
// judged abandoned (someone reclaimed and re-acquired first), it hands that lock straight back.
function reclaimAbandonedLock(lockPath: string): boolean {
  const owner = readLockFile(lockPath, LOCK_OWNER_FILE);
  if (!isAbandonedLock(lockPath, owner)) return false;
  const claimed = `${lockPath}.abandoned.${process.pid}.${Date.now()}`;
  try {
    renameSync(lockPath, claimed);
  } catch {
    return false;
  }
  if (readLockFile(claimed, LOCK_OWNER_FILE) !== owner) {
    try {
      renameSync(claimed, lockPath);
    } catch {}
    return false;
  }
  recoverAbandonedBootstrap(claimed);
  rmSync(claimed, { recursive: true, force: true });
  return true;
}

function isAbandonedLock(lockPath: string, owner: string | null): boolean {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) return true;
    return owner !== null && !isPidAlive(JSON.parse(owner)?.pid);
  } catch {
    return false;
  }
}

// The transport is recorded before spawning, so a broker orphaned at any point is found by it.
function recoverAbandonedBootstrap(lockPath: string): void {
  let spawned: { isolatedHome?: unknown; transportUrl?: unknown };
  try {
    spawned = JSON.parse(readLockFile(lockPath, LOCK_SPAWN_FILE) ?? "");
    if (!isIsolatedBrokerHome(spawned.isolatedHome)) return;
    if (spawned.transportUrl !== chooseTransport(spawned.isolatedHome)) return;
  } catch {
    return;
  }
  for (const pid of findBrokerPids(spawned.transportUrl)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
  removeIsolatedBrokerHome(spawned.isolatedHome);
}

function recordBootstrapSpawn(lockPath: string, spawned: { isolatedHome: string; transportUrl: string }): void {
  const file = join(lockPath, LOCK_SPAWN_FILE);
  writeFileSync(`${file}.tmp`, JSON.stringify(spawned));
  renameSync(`${file}.tmp`, file);
}

export function releaseBrokerLock(lockPath: string | null): void {
  if (!lockPath) return;
  try {
    rmSync(lockPath, { recursive: true, force: true });
  } catch {
    // Best-effort; an abandoned lock is reclaimed by the next acquireBrokerLock.
  }
}

// Poll the transport for reachability. Different probes per scheme:
//   - unix:// — check the socket file exists + try net.connect once
//   - ws://   — try net.connect to host:port
// Returns true on first reachable response, false after the budget. The
// caller still has to perform `initialize` separately — reachability is
// necessary but not sufficient for "broker is healthy" per ADR-093.
export async function pollSocketReachable(transportUrl: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const reachable = await probeOnce(transportUrl);
    if (reachable) return true;
    await sleep(SOCKET_POLL_INTERVAL_MS);
  }
  return false;
}

function probeOnce(transportUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    let connectOptions: NetConnectOpts;
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
    const settle = (ok: boolean) => {
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
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Spawn `codex app-server --listen <transport>` detached so it outlives
// SessionStart's process. stdio is redirected to broker.log (open via
// O_APPEND so multiple writers — unlikely but defensive — don't tear).
// Returns the spawned ChildProcess; caller is responsible for tracking
// the pid and writing it to the descriptor only after handshake succeeds.
export function spawnBroker(markerDir: string, transportUrl: string, isolatedHome: string): ChildProcess {
  if (!isIsolatedBrokerHome(isolatedHome)) throw new Error("broker requires an isolated Codex home");
  const logFd = openSync(brokerLogPath(markerDir), "a");
  const child = spawn("codex", ["app-server", "--listen", transportUrl], {
    detached: true,
    env: { ...process.env, CODEX_HOME: isolatedHome },
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
export function readCodexVersion(): string {
  try {
    const out = execFileSync("codex", ["--version"], { timeout: 2000, encoding: "utf-8" });
    return (out || "").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

// Atomic descriptor write via tmp+rename (ADR-086). Caller ensures
// stateRoot(markerDir) exists (acquireBrokerLock creates it).
export async function writeBrokerDescriptor(markerDir: string, descriptor: BrokerDescriptor): Promise<string> {
  const finalPath = join(stateRoot(markerDir), "broker.json");
  const tmpPath = `${finalPath}.tmp.${process.pid}`;
  await writeFile(tmpPath, JSON.stringify(descriptor, null, 2));
  await rename(tmpPath, finalPath);
  return finalPath;
}

export async function unlinkBrokerDescriptor(markerDir: string): Promise<void> {
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
let cachedPluginVersion: string | null = null;
export function readPluginVersion(): string {
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
  return cachedPluginVersion as string;
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
export async function bootstrapBroker(
  markerDir: string,
  options: BootstrapOptions = {},
): Promise<BrokerDescriptor | null> {
  const { budgetMs = BOOTSTRAP_BUDGET_MS_DEFAULT, injectDeps } = options;
  const spawnFn = injectDeps?.spawnBroker ?? spawnBroker;
  const initFn = injectDeps?.initializeBroker ?? initializeBroker;
  const pollFn = injectDeps?.pollSocketReachable ?? pollSocketReachable;
  const versionFn = injectDeps?.readCodexVersion ?? readCodexVersion;

  const lockPath = acquireBrokerLock(markerDir);
  if (!lockPath) return null; // another SessionStart holds the lock

  const deadline = Date.now() + budgetMs;
  let child: ChildProcess | null = null;
  let isolatedHome: string | null = null;
  let connection: BrokerSession["connection"] | null = null; // hoisted so the catch block can close on descriptor-write failure
  try {
    const previous = readBrokerDescriptorSync(markerDir);
    if (previous) {
      const startedAt = Date.parse(previous.startedAt ?? "");
      const ageMs = Date.now() - startedAt;
      const expired = !Number.isFinite(ageMs) || ageMs >= BROKER_OWNER_TTL_MS || ageMs < -5 * 60 * 1000;
      if (!expired && (injectDeps?.isRecordedBroker ?? isRecordedBroker)(previous)) return previous;
      await teardownBroker(markerDir, { lockHeld: true, injectDeps });
    }
    isolatedHome = createIsolatedBrokerHome({ sourceHome: options.sourceHome });
    const transportUrl = chooseTransport(isolatedHome);
    recordBootstrapSpawn(lockPath, { isolatedHome, transportUrl });
    child = spawnFn(markerDir, transportUrl, isolatedHome);

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
    if (
      typeof initializeResult?.codexHome !== "string" ||
      realpathSync(initializeResult.codexHome) !== realpathSync(isolatedHome)
    ) {
      throw new Error("broker reported an unexpected Codex home");
    }

    const descriptor: BrokerDescriptor = {
      pid: child.pid as number,
      transportUrl,
      codexVersion: versionFn(),
      codexHome: initializeResult?.codexHome ?? null,
      isolatedHome,
      sessionId: options.sessionId ?? null,
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
    if (isolatedHome) removeIsolatedBrokerHome(isolatedHome);
    return null;
  } finally {
    releaseBrokerLock(lockPath);
  }
}

// ──── SessionEnd teardown (M2 PR 3) ────────────────────────────────────

// Read the broker descriptor synchronously. Returns the parsed object
// or null on any error (missing, malformed, unreadable). Used by
// teardownBroker AND by the per-edit hook's readBrokerState lookup.
export function readBrokerDescriptorSync(markerDir: string): BrokerDescriptor | null {
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
export function isPidAlive(pid: unknown): pid is number {
  if (typeof pid !== "number" || pid <= 0) return false;
  if (IS_WINDOWS) return true; // best-effort; rely on terminateProcessTree
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process. EPERM = process exists but we don't own
    // it (rare for our own-spawned broker but possible across user
    // switches); treat as "live" since we can't safely conclude dead.
    if ((err as NodeJS.ErrnoException)?.code === "EPERM") return true;
    return false;
  }
}

// Descriptors outlive crashes and reboots, so a recorded pid may since belong to an unrelated process.
export function isRecordedBroker(descriptor: Pick<BrokerDescriptor, "pid" | "transportUrl">): boolean {
  if (IS_WINDOWS || !isPidAlive(descriptor.pid) || typeof descriptor.transportUrl !== "string") return false;
  try {
    const args = execFileSync("ps", ["-ww", "-o", "args=", "-p", String(descriptor.pid)], {
      encoding: "utf-8",
      timeout: 2000,
    });
    return isBrokerCommand(args, descriptor.transportUrl);
  } catch {
    return false;
  }
}

function isBrokerCommand(args: string, transportUrl: string): boolean {
  const argv = args.trim().split(/\s+/);
  const at = argv.indexOf("app-server");
  return (
    at > 0 &&
    /^codex(\.\w+)?$/.test(basename(argv[at - 1])) &&
    argv.slice(at + 1).join(" ") === `--listen ${transportUrl}`
  );
}

function findBrokerPids(transportUrl: string): number[] {
  if (IS_WINDOWS) return [];
  try {
    const table = execFileSync("ps", ["-ax", "-ww", "-o", "pid=,args="], { encoding: "utf-8", timeout: 2000 });
    return table.split("\n").flatMap((line) => {
      const row = line.match(/^\s*(\d+)\s+(.*)$/);
      return row && isBrokerCommand(row[2], transportUrl) ? [Number(row[1])] : [];
    });
  } catch {
    return [];
  }
}

async function killRecordedBroker(descriptor: BrokerDescriptor, graceMs: number): Promise<boolean> {
  return isRecordedBroker(descriptor) ? killPidGracefully(descriptor.pid, graceMs) : false;
}

// Send SIGTERM, poll for exit, escalate to terminateProcessTree if the
// process is still alive after the grace period. Returns boolean (was
// the pid actually live before we killed it).
async function killPidGracefully(pid: number, graceMs: number): Promise<boolean> {
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
async function unlinkTransportArtifact(transportUrl: unknown, markerDir: string): Promise<void> {
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
export function clearStaleBrokerState(markerDir: string): "absent" | "live" | "stale" {
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
  let socketOk: boolean;
  // Hoist sockPath so the cleanup block can reference it; only the unix
  // branch sets it to a real path, other branches leave it null.
  let sockPath: string | null = null;
  if (typeof descriptor.transportUrl !== "string") {
    socketOk = false;
  } else if (descriptor.transportUrl.startsWith("unix://")) {
    sockPath = extractSafeSocketPath(descriptor.transportUrl, markerDir, descriptor.isolatedHome);
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

// Path-safety: a descriptor may only point at a socket inside its own isolated home or, for
// descriptors written before ADR-168, under the marker's state root.
function extractSafeSocketPath(transportUrl: unknown, markerDir: string, isolatedHome?: unknown): string | null {
  if (typeof transportUrl !== "string" || !transportUrl.startsWith("unix://")) {
    return null;
  }
  const sockPath = transportUrl.slice("unix://".length);
  if (!sockPath) return null;
  const resolvedSock = resolvePath(sockPath);
  const roots = [resolvePath(stateRoot(markerDir))];
  if (isIsolatedBrokerHome(isolatedHome)) roots.push(resolvePath(isolatedHome));
  return roots.some((root) => resolvedSock.startsWith(`${root}/`)) ? resolvedSock : null;
}

// SessionEnd orchestrator. Reads the descriptor, signals the broker pid
// to exit gracefully, terminateProcessTree if it doesn't, and cleans up
// the descriptor + socket + lock. Always exits successfully — ADR-077.
//
// Options:
//   - graceMs (default 1500) — how long to wait for SIGTERM to land
//     before escalating to SIGKILL.
//   - injectDeps — { killPid, unlinkSock } for testing.
export async function teardownBroker(
  markerDir: string,
  options: TeardownOptions = {},
): Promise<BrokerDescriptor | null> {
  const { graceMs = 1500, injectDeps } = options;
  const unlinkSockFn = injectDeps?.unlinkSock ?? unlinkTransportArtifact;
  const lockPath = options.lockHeld ? brokerLockPath(markerDir) : acquireBrokerLock(markerDir);
  if (!lockPath) return null;
  try {
    const descriptor = readBrokerDescriptorSync(markerDir);
    if (!descriptor || ("sessionId" in options && (!options.sessionId || descriptor.sessionId !== options.sessionId))) {
      return null;
    }
    try {
      if (injectDeps?.killPid) await injectDeps.killPid(descriptor.pid, graceMs);
      else await killRecordedBroker(descriptor, graceMs);
    } catch {
      // best-effort
    }
    try {
      await unlinkSockFn(descriptor.transportUrl, markerDir);
    } catch {
      // best-effort
    }
    await unlinkBrokerDescriptor(markerDir);
    removeIsolatedBrokerHome(descriptor.isolatedHome);
    return descriptor;
  } finally {
    if (!options.lockHeld) releaseBrokerLock(lockPath);
  }
}

// Test-only exports
export const __testing__ = {
  BROKER_LOCK_DIR,
  BROKER_LOG_FILE,
  BROKER_SOCKET_FILE,
  MAX_UNIX_SOCKET_PATH_BYTES,
  BOOTSTRAP_BUDGET_MS_DEFAULT,
  isPidAlive,
  killPidGracefully,
  unlinkTransportArtifact,
};
