import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, renameSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { executeClaudeCLI, isNestedSessionBlocked } from "@ask-llm/mcp/providers/claude/executor";
import {
  executeCodexCLI,
  isModelUnavailableError,
  isQuotaError,
  type CodexExecutorOptions,
} from "@ask-llm/mcp/providers/codex/executor";
import { parseFrontmatter } from "../../scripts/lib/frontmatter.mjs";
import { loadPairDefaults } from "../../scripts/lib/pair-config-io.mjs";
import { resolveConfig } from "../../scripts/lib/pair-config.mjs";
import {
  isCachedReviewCompatible,
  reviewAttribution,
  reviewCacheModel,
  resolveReviewer,
  type Reviewer,
  type WriterFamily,
} from "../../scripts/lib/pair-semantics.mjs";
import { buildReviewPrompt } from "../../scripts/lib/prompt.mjs";
import {
  AUTOPAUSE_FAILURE_THRESHOLD,
  INFLIGHT_TTL_MIN_MS,
  addAck,
  appendLog,
  clearAutoPause,
  clearReviewFailures,
  computeCacheKey,
  getCachedConcerns,
  hashConcernBody,
  logPath,
  pausePath,
  readAcks,
  readPauseInfo,
  readPluginVersion,
  recordReviewFailure,
  releaseInflightLock,
  resolveAutoResume,
  setCachedConcerns,
  stateRoot,
  tryAcquireInflightLock,
  writeAutoPause,
  type ReviewAttribution,
} from "../../scripts/lib/state.mjs";
import { buildVerdictMessage, parseRecognizedConcerns, type Concerns } from "../../scripts/lib/parser.mjs";

const MAX_TIMER_MS = 2_147_483_647;
const MESSAGE_TYPE = "ask-llm-codex-pair";
const ALLOWLIST_FILE = "codex-pair-projects.json";
const ALLOWLIST_LOCK_RETRY_MS = 25;
const ALLOWLIST_LOCK_TIMEOUT_MS = 5_000;
const ALLOWLIST_LOCK_STALE_MS = 30_000;
const LOCK_CONTENTION_RETRY_MS = 100;
const CLAIM_SUFFIX = ".claim";
const CLAIM_STALE_MS = 30_000;
const PI_PENDING_DIR = "pi-pending";
const PI_REVIEWED_DIR = "pi-reviewed";
const SKIP_PARTS = ["/.git/", "/node_modules/", "/dist/", "/build/", "/.next/", "/coverage/", "/.codex-pair/"];
const SKIP_SUFFIXES = [
  ".lock",
  ".snap",
  ".map",
  ".min.js",
  ".min.css",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".wasm",
];
const SKIP_FILENAMES = [
  "yarn.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "cargo.lock",
  "gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "go.sum",
];

type PairConfig = ReturnType<typeof resolveConfig>;

interface Writer {
  provider?: string;
  id?: string;
}

interface ReviewContext {
  config: PairConfig;
  context: string;
  signature: string;
}

interface ScheduledReview {
  generation: number;
  firstAt: number;
  markerDir: string;
  target: string;
  toolName: string;
  writer: Writer;
  reviewContext: ReviewContext;
  grant: Grant;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}

interface PairFinding {
  id: string;
  file: string;
  markerDir: string;
  contentHash: string;
  message: string;
  createdAt: string;
  review?: ReviewIdentity & { toolName: string; target: string; writer: Writer; grant: Grant };
}

interface ReviewIdentity extends ReviewAttribution {
  fingerprint: string;
  observedModel?: string;
}

interface ReviewedRecord {
  contentHash: string;
  findingId: string;
  deliveredAt: string;
  review?: ReviewIdentity;
}

interface Grant {
  root: string;
  allowedAt: string;
  reviewer: Reviewer;
  id?: string;
}

interface AllowlistLock {
  id: string;
  pid: number;
  acquiredAt: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function configDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function allowlistPath(): string {
  return join(configDir(), "ask-llm", ALLOWLIST_FILE);
}

async function writeJsonAtomic(path: string, value: unknown, canCommit = () => true): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${randomUUID()}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    if (!canCommit()) return false;
    renameSync(tmp, path);
    return true;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

function readAllowlist(): { projects: Grant[] } {
  let raw: string;
  try {
    raw = readFileSync(allowlistPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { projects: [] };
    throw error;
  }
  let parsed: { version?: unknown; projects?: Array<Partial<Grant> | null> } | null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid Pi codex-pair allowlist JSON. Check codex-pair-projects.json in your Pi config.");
  }
  if ((parsed?.version !== 1 && parsed?.version !== 2) || !Array.isArray(parsed.projects)) {
    throw new Error("Unsupported Pi codex-pair allowlist. Check codex-pair-projects.json in your Pi config.");
  }
  const roots = new Map<string, Grant | undefined>();
  for (const row of parsed.projects) {
    if (typeof row?.root !== "string" || !isAbsolute(row.root)) continue;
    const reviewer = parsed.version === 1 ? "codex" : row.reviewer;
    if (
      !roots.has(row.root) &&
      typeof row.allowedAt === "string" &&
      Number.isFinite(Date.parse(row.allowedAt)) &&
      (reviewer === "codex" || reviewer === "claude") &&
      (row.id === undefined || typeof row.id === "string")
    ) {
      roots.set(row.root, { root: row.root, allowedAt: row.allowedAt, reviewer, id: row.id });
    } else {
      roots.set(row.root, undefined);
    }
  }
  return { projects: [...roots.values()].filter((row) => row !== undefined) };
}

function findGrant(markerDir: string, reviewer: Reviewer): Grant | undefined {
  return readAllowlist().projects.find((entry) => entry.root === markerDir && entry.reviewer === reviewer);
}

async function recoverAbandonedAllowlistLock(lockPath: string): Promise<boolean> {
  try {
    const content = await readFile(lockPath, "utf8");
    const lock = JSON.parse(content) as Partial<AllowlistLock>;
    const info = await stat(lockPath);
    const acquiredAt = typeof lock.acquiredAt === "string" ? Date.parse(lock.acquiredAt) : Number.NaN;
    const pid = typeof lock.pid === "number" ? lock.pid : Number.NaN;
    if (
      typeof lock.id !== "string" ||
      !Number.isInteger(pid) ||
      !Number.isFinite(acquiredAt) ||
      Date.now() - acquiredAt <= ALLOWLIST_LOCK_STALE_MS ||
      Date.now() - info.mtimeMs <= ALLOWLIST_LOCK_STALE_MS ||
      processIsAlive(pid)
    ) {
      return false;
    }
    const recheckContent = await readFile(lockPath, "utf8");
    const recheckInfo = await stat(lockPath);
    if (recheckContent !== content || recheckInfo.mtimeMs !== info.mtimeMs) return false;
    await unlink(lockPath);
    return true;
  } catch {
    return false;
  }
}

async function releaseOwnedAllowlistLock(lockPath: string, identity: string): Promise<void> {
  try {
    if ((await readFile(lockPath, "utf8")) === identity) await unlink(lockPath);
  } catch {}
}

async function setAllowed(markerDir: string, reviewer: Reviewer | false, canCommit?: () => boolean): Promise<boolean> {
  if ((await realpath(markerDir)) !== markerDir) throw new Error("Pi codex-pair project path changed.");
  const lockPath = `${allowlistPath()}.lock`;
  const lock = {
    id: randomUUID(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  } satisfies AllowlistLock;
  const identity = `${JSON.stringify(lock)}\n`;
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + ALLOWLIST_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      await writeFile(lockPath, identity, { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await recoverAbandonedAllowlistLock(lockPath)) continue;
      if (Date.now() >= deadline) throw new Error("Timed out updating the codex-pair project allowlist");
      await new Promise((resolveWait) => setTimeout(resolveWait, ALLOWLIST_LOCK_RETRY_MS));
    }
  }
  try {
    const current = readAllowlist();
    const projects = current.projects.filter((entry) => entry.root !== markerDir);
    if (reviewer) projects.push({ root: markerDir, reviewer, allowedAt: new Date().toISOString(), id: randomUUID() });
    return await writeJsonAtomic(allowlistPath(), { version: 2, projects }, canCommit);
  } finally {
    await releaseOwnedAllowlistLock(lockPath, identity);
  }
}

function findMarkerUp(start: string): string | undefined {
  let current = start;
  try {
    const info = statSync(current);
    if (!info.isDirectory()) current = dirname(current);
  } catch {
    current = dirname(current);
  }
  current = resolve(current);
  const root = parse(current).root;
  for (let depth = 0; depth < 40; depth++) {
    if (existsSync(join(current, ".codex-pair", "context.md"))) return realpathSync(current);
    if (current === root) break;
    current = dirname(current);
  }
  return undefined;
}

function writerIdentity(model: Writer | undefined): Writer {
  return { provider: model?.provider, id: model?.id };
}

function writerFamily(writer: Writer): WriterFamily {
  if (!writer.id) return "unknown";
  switch (writer.provider) {
    case "openai":
    case "openai-codex":
      return "codex";
    case "anthropic":
      return "claude";
    case "xai":
      return "grok";
    default:
      return "unknown";
  }
}

function readConfig(markerDir: string, writer: Writer): ReviewContext {
  const marker = join(markerDir, ".codex-pair", "context.md");
  if (realpathSync(marker) !== marker || !statSync(marker).isFile()) {
    throw new Error("Pi codex-pair requires a regular .codex-pair/context.md within the marked project.");
  }
  const markerText = readFileSync(marker, "utf8");
  const { frontmatter, body, malformed } = parseFrontmatter(markerText);
  if (malformed || markerText === "---" || markerText === "---\r") {
    throw new Error("Pi codex-pair refused: close the initial frontmatter fence in .codex-pair/context.md.");
  }
  const bounded = (value: number, min: number) => Number.isInteger(value) && value >= min && value <= MAX_TIMER_MS;
  const env = { ...process.env };
  for (const [key, min] of [
    ["ASK_CODEX_TIMEOUT_MS", 1],
    ["ASK_CLAUDE_TIMEOUT_MS", 1],
    ["GMCPT_TIMEOUT_MS", 1],
    ["ASK_CODEX_DEBOUNCE_MS", 0],
    ["ASK_CODEX_DEBOUNCE_MAX_MS", 1],
    ["CODEX_PAIR_MAX_FILE_BYTES", 1],
  ] as const) {
    if (!env[key]?.trim() || !bounded(Number(env[key]), min)) delete env[key];
  }
  env.ASK_CODEX_TIMEOUT_MS ??= env.GMCPT_TIMEOUT_MS;
  if (!env.ASK_CODEX_MODEL?.trim()) delete env.ASK_CODEX_MODEL;
  if (!env.ASK_CODEX_FALLBACK_MODEL?.trim()) delete env.ASK_CODEX_FALLBACK_MODEL;
  for (const [key, min] of [
    ["timeoutMs", 1],
    ["debounceMs", 0],
    ["debounceMaxMs", 1],
    ["maxFileBytes", 1],
  ] as const) {
    const value = frontmatter[key];
    if (typeof value !== "number" || !bounded(value, min)) delete frontmatter[key];
  }
  const config = resolveConfig(frontmatter, writerFamily(writer), env, loadPairDefaults());
  // Claude has no fallback or configurable effort. Ignore Codex-only knobs in its fingerprint.
  if (config.reviewer === "claude") {
    config.fallbackModel = "";
    config.reasoningEffort = "unknown";
  }
  const context = adaptiveContent(body, config.maxFileBytes).content.trim();
  return {
    context,
    config,
    signature: hash(JSON.stringify([config, context])),
  };
}

function normalizeToolPath(inputPath: unknown, cwd: string): string | undefined {
  if (typeof inputPath !== "string" || inputPath.trim().length === 0) return undefined;
  const withoutAt = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
  return isAbsolute(withoutAt) ? resolve(withoutAt) : resolve(cwd, withoutAt);
}

function canonicalRegularFile(path: string): string | undefined {
  try {
    const canonical = realpathSync(path);
    return statSync(canonical).isFile() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

function shouldSkip(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return (
    SKIP_PARTS.some((part) => normalized.includes(part)) ||
    SKIP_FILENAMES.some((name) => normalized === name || normalized.endsWith(`/${name}`)) ||
    SKIP_SUFFIXES.some((part) => normalized.endsWith(part))
  );
}

function deleteScheduledIfOwned(scheduled: Map<string, ScheduledReview>, file: string, generation: number): boolean {
  if (scheduled.get(file)?.generation !== generation) return false;
  scheduled.delete(file);
  return true;
}

function isBinaryContent(content: Buffer): boolean {
  if (content.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(content);
    return false;
  } catch {
    return true;
  }
}

function reviewedPath(markerDir: string, file: string): string {
  return join(stateRoot(markerDir), PI_REVIEWED_DIR, `${hash(file).slice(0, 16)}.json`);
}

function pendingPath(markerDir: string, id: string): string {
  return join(stateRoot(markerDir), PI_PENDING_DIR, `${id}.json`);
}

async function readReviewed(markerDir: string, file: string): Promise<ReviewedRecord | undefined> {
  try {
    return JSON.parse(await readFile(reviewedPath(markerDir, file), "utf8")) as ReviewedRecord;
  } catch {
    return undefined;
  }
}

async function markReviewed(finding: PairFinding): Promise<void> {
  await writeJsonAtomic(reviewedPath(finding.markerDir, finding.file), {
    contentHash: finding.contentHash,
    findingId: finding.id,
    deliveredAt: finding.createdAt,
    review: finding.review,
  } satisfies ReviewedRecord);
}

function sendFinding(pi: ExtensionAPI, finding: PairFinding): void {
  pi.sendMessage(
    {
      customType: MESSAGE_TYPE,
      content: `${finding.message}\n\nPi note: findings are advisory and non-blocking.`,
      display: true,
      details: { file: finding.file, project: finding.markerDir, findingId: finding.id },
    },
    { deliverAs: "steer", triggerTurn: false },
  );
}

interface ClaimedFinding {
  claimPath: string;
  pendingPath: string;
  finding: PairFinding;
}

function pendingRoot(markerDir: string): string {
  return join(stateRoot(markerDir), PI_PENDING_DIR);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseClaimOwner(content: string): number | undefined {
  try {
    const { pid } = JSON.parse(content) as { pid?: unknown };
    return typeof pid === "number" && Number.isInteger(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

async function recoverAbandonedClaims(markerDir: string): Promise<void> {
  const root = pendingRoot(markerDir);
  try {
    const names = (await readdir(root)).filter((name) => name.endsWith(CLAIM_SUFFIX)).sort();
    for (const name of names) {
      const claimPath = join(root, name);
      const content = await readFile(claimPath, "utf8").catch(() => undefined);
      const info = await stat(claimPath).catch(() => undefined);
      // A live session releases and recreates claims at this same path, so only age plus an
      // unchanged-identity recheck can tell an abandoned claim from one that was just taken.
      if (content === undefined || !info || Date.now() - info.mtimeMs < CLAIM_STALE_MS) continue;
      const pid = parseClaimOwner(content);
      if (pid !== undefined && processIsAlive(pid)) continue;
      const recheck = await readFile(claimPath, "utf8").catch(() => undefined);
      const recheckInfo = await stat(claimPath).catch(() => undefined);
      if (recheck !== content || recheckInfo?.mtimeMs !== info.mtimeMs) continue;
      try {
        await unlink(claimPath);
      } catch {}
    }
  } catch {}
}

async function reserveClaim(path: string): Promise<string | undefined> {
  const claimPath = `${path}${CLAIM_SUFFIX}`;
  try {
    await writeFile(claimPath, `${JSON.stringify({ pid: process.pid })}\n`, { flag: "wx", mode: 0o600 });
    return claimPath;
  } catch {
    return undefined;
  }
}

async function claimPending(path: string): Promise<ClaimedFinding | undefined> {
  const claimPath = await reserveClaim(path);
  if (!claimPath) return undefined;
  try {
    return {
      claimPath,
      pendingPath: path,
      finding: JSON.parse(await readFile(path, "utf8")) as PairFinding,
    };
  } catch {
    for (const target of [path, claimPath]) {
      try {
        await unlink(target);
      } catch {}
    }
    return undefined;
  }
}

function adaptiveContent(content: string, maxBytes: number): { content: string; partial: boolean } {
  const bytes = Buffer.from(content);
  if (bytes.length <= maxBytes) return { content, partial: false };
  const separator = "\n\n[... middle omitted by codex-pair size bound ...]\n\n";
  const available = maxBytes - Buffer.byteLength(separator);
  let head = available > 1 ? Math.ceil(available / 2) : maxBytes;
  while (head > 0 && (bytes[head] & 0xc0) === 0x80) head--;
  if (available <= 1) return { content: bytes.subarray(0, head).toString(), partial: true };
  let tail = bytes.length - Math.floor(available / 2);
  while (tail < bytes.length && (bytes[tail] & 0xc0) === 0x80) tail++;
  return {
    content: bytes.subarray(0, head).toString() + separator + bytes.subarray(tail).toString(),
    partial: true,
  };
}

function activeConcerns(concerns: Concerns, acks: Record<string, unknown>): Concerns {
  const unacked = (body: string) => !Object.hasOwn(acks, hashConcernBody(body));
  return {
    high: concerns.high.filter(unacked),
    med: concerns.med.filter(unacked),
    low: concerns.low.filter(unacked),
  };
}

function sameGrant(expected: Grant, current: Grant | undefined): boolean {
  return (
    expected.root === current?.root &&
    expected.reviewer === current.reviewer &&
    expected.allowedAt === current.allowedAt &&
    expected.id === current.id
  );
}

function fitsReview(config: PairConfig, value: Partial<ReviewAttribution>): value is ReviewAttribution {
  return (
    value.reviewer === config.reviewer &&
    value.reasoningEffort === config.reasoningEffort &&
    (value.fellBack === false
      ? value.model === config.model
      : value.fellBack === true &&
        config.reviewer === "codex" &&
        config.fallbackModel !== config.model &&
        isCachedReviewCompatible(value, config.fallbackModel))
  );
}

function reviewInput(file: string, toolName: string, raw: string, { config, context, signature }: ReviewContext) {
  const view = adaptiveContent(raw, config.maxFileBytes);
  const prompt = buildReviewPrompt({
    filePath: file,
    fileContent: view.content,
    toolName: `Pi ${toolName}`,
    projectContext: context,
    partialView: view.partial,
  });
  const cacheKey = computeCacheKey({
    model: reviewCacheModel(config.reviewer, config.model),
    reasoningEffort: config.reasoningEffort,
    prompt,
    fileContent: view.content,
    surfaceThreshold: config.surfaceThreshold,
  });
  return { prompt, cacheKey, fingerprint: hash(JSON.stringify([cacheKey, signature])) };
}

class CodexQuotaPause extends Error {}

function isReviewQuotaError(error: unknown): boolean {
  // The Codex predicate matches HTTP 429. Exclude local timeout diagnostics
  // such as "Command timed out ... (current: 429ms)" before classifying quota.
  return !(error instanceof Error && error.message.startsWith("Command timed out")) && isQuotaError(error);
}

async function runReview(
  work: ScheduledReview,
  prompt: string,
  checkEligibility: () => void,
): Promise<{ concerns: Concerns; attribution: ReviewAttribution & { observedModel?: string } }> {
  const { config } = work.reviewContext;
  const options = {
    prompt,
    cwd: work.markerDir,
    timeoutMs: config.timeoutMs,
    signal: work.controller.signal,
    singleAttempt: true,
    killProcessGroup: true,
  } as const;
  const attemptCodex = (model: string) => {
    checkEligibility();
    return executeCodexCLI({
      ...options,
      model,
      // The shared resolver validates the Codex effort. Pi only assigns "unknown" on the Claude route.
      reasoningEffort: config.reasoningEffort as CodexExecutorOptions["reasoningEffort"],
      sandbox: "read-only",
      beforeSpawn: checkEligibility,
    });
  };
  let fellBack = false;
  let result;
  if (config.reviewer === "claude") {
    checkEligibility();
    if (isNestedSessionBlocked()) {
      throw new Error(
        "Claude CLI refuses nested Claude Code sessions. Launch Pi separately from Claude Code and retry.",
      );
    }
    result = await executeClaudeCLI({ ...options, model: config.model });
  } else {
    try {
      result = await attemptCodex(config.model);
    } catch (error) {
      checkEligibility();
      if (isModelUnavailableError(error) || !isReviewQuotaError(error)) throw error;
      const fallback = config.fallbackModel;
      if (fallback === config.model) {
        throw new CodexQuotaPause(`Codex quota exhausted. Configure a distinct fallbackModel (currently ${fallback}).`);
      }
      try {
        result = await attemptCodex(fallback);
        fellBack = true;
      } catch (fallbackError) {
        checkEligibility();
        if (isReviewQuotaError(fallbackError) || isModelUnavailableError(fallbackError)) {
          throw new CodexQuotaPause(
            `Codex quota exhausted and configured fallback ${fallback} was unavailable. Check fallbackModel or ASK_CODEX_FALLBACK_MODEL.`,
          );
        }
        throw fallbackError;
      }
    }
  }
  checkEligibility();
  if (result.usage?.fellBack)
    throw new Error("Reviewer reported an unexpected model change. Verify the selected model.");
  const concerns = parseRecognizedConcerns(result.response);
  if (!concerns) throw new Error("Reviewer reply was unrecognized. Inspect the selected CLI and try another edit.");
  const observedModel = "observedModel" in result ? result.observedModel : undefined;
  return { concerns, attribution: { ...reviewAttribution(config, fellBack), observedModel } };
}

export function registerCodexPair(pi: ExtensionAPI): void {
  const scheduled = new Map<string, ScheduledReview>();
  const toolWriters = new Map<string, Writer>();
  const active = new Set<Promise<void>>();
  const changingProjects = new Set<string>();
  const projectRevisions = new Map<string, number>();
  const initializedSessions = new Set<string>();
  let closed = false;
  let epoch = 0;
  let nextGeneration = 0;
  let latestWriter: Writer = {};

  const notifyRefusal = (ctx: ExtensionContext, message: string) => {
    if (ctx.hasUI) ctx.ui.notify(message, "warning");
  };

  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

  const sessionOwnsProject = (ctx: ExtensionContext, markerDir: string): boolean =>
    ctx.isProjectTrusted() && findMarkerUp(ctx.cwd) === markerDir && realpathSync(markerDir) === markerDir;

  const fileInProject = (target: string, file: string, markerDir: string): boolean =>
    !shouldSkip(file) &&
    canonicalRegularFile(target) === file &&
    findMarkerUp(target) === markerDir &&
    findMarkerUp(file) === markerDir;

  const independentContext = (markerDir: string, writer: Writer): ReviewContext => {
    const resolved = readConfig(markerDir, writer);
    resolveReviewer(resolved.config.reviewer, writerFamily(latestWriter));
    return resolved;
  };

  const pairIsPaused = async (markerDir: string): Promise<boolean> => {
    const pauseInfo = readPauseInfo(markerDir);
    if (!pauseInfo) return false;
    const decision = resolveAutoResume(pauseInfo, {
      now: Date.now(),
      currentVersion: readPluginVersion(),
    });
    if (!decision.resume || !clearAutoPause(markerDir, pauseInfo)) return true;
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      verdict: "auto_resumed",
      source: "pi",
      reason: decision.why,
    });
    return false;
  };

  const cancelWork = (file: string, work: ScheduledReview, reason: string) => {
    if (work.timer) clearTimeout(work.timer);
    work.controller.abort(new DOMException(reason, "AbortError"));
    deleteScheduledIfOwned(scheduled, file, work.generation);
  };

  const cancelProject = (markerDir: string, reason: string) => {
    projectRevisions.set(markerDir, (projectRevisions.get(markerDir) ?? 0) + 1);
    for (const [file, work] of scheduled) {
      if (work.markerDir === markerDir) cancelWork(file, work, reason);
    }
  };

  const releaseClaim = async (claimed: ClaimedFinding) => {
    await unlink(claimed.claimPath).catch(() => {});
  };

  const consumeClaimed = (claimed: ClaimedFinding) => unlink(claimed.pendingPath).catch(() => {});

  const deliverClaimed = async (claimed: ClaimedFinding, ctx: ExtensionContext, markerDir: string) => {
    const finding = claimed.finding;
    try {
      if (
        closed ||
        changingProjects.has(markerDir) ||
        readPauseInfo(markerDir) ||
        !sessionOwnsProject(ctx, markerDir) ||
        finding?.markerDir !== markerDir ||
        typeof finding.file !== "string" ||
        typeof finding.message !== "string" ||
        pendingPath(markerDir, finding.id) !== claimed.pendingPath
      )
        return;

      const saved = finding.review;
      const target = saved === undefined ? finding.file : saved?.target;
      if (typeof target !== "string" || !fileInProject(target, finding.file, markerDir)) return;
      const raw = readFileSync(finding.file, "utf8");
      if (hash(raw) !== finding.contentHash) {
        await consumeClaimed(claimed);
        return;
      }

      if (
        saved !== undefined &&
        (!saved?.writer || !saved.grant || (saved.toolName !== "edit" && saved.toolName !== "write"))
      )
        return;
      const resolved = independentContext(markerDir, saved?.writer ?? {});
      const grant = findGrant(markerDir, resolved.config.reviewer);
      if (!grant) return;
      if (saved) {
        if (
          !sameGrant(saved.grant, grant) ||
          !fitsReview(resolved.config, saved) ||
          reviewInput(finding.file, saved.toolName, raw, resolved).fingerprint !== saved.fingerprint
        )
          return;
        sendFinding(pi, finding);
      } else if (resolved.config.reviewer === "codex") {
        sendFinding(pi, {
          ...finding,
          message: `Reviewer: Codex (legacy finding, model unknown) · Writer: unknown\n\n${finding.message}`,
        });
      } else {
        return;
      }
      await markReviewed(finding);
      await consumeClaimed(claimed);
    } catch (error) {
      if (!closed) notifyRefusal(ctx, `Pi codex-pair could not deliver a pending finding. ${errorMessage(error)}`);
    }
  };

  const drainPending = async (markerDir: string, ctx: ExtensionContext) => {
    await recoverAbandonedClaims(markerDir);
    const entries = await readdir(pendingRoot(markerDir)).catch(() => []);
    for (const name of entries.sort()) {
      if (closed) return;
      if (!name.endsWith(".json")) continue;
      const claimed = await claimPending(join(pendingRoot(markerDir), name));
      if (claimed) {
        try {
          await deliverClaimed(claimed, ctx, markerDir);
        } finally {
          await releaseClaim(claimed);
        }
      }
    }
  };

  const armReview = (file: string, work: ScheduledReview, delay: number, myEpoch: number, ctx: ExtensionContext) => {
    work.timer = setTimeout(() => {
      work.timer = undefined;
      const promise = review(file, work, myEpoch, ctx).catch((error) => {
        if (!closed && error?.name !== "AbortError") notifyRefusal(ctx, `Pi codex-pair: ${errorMessage(error)}`);
      });
      active.add(promise);
      void promise.finally(() => active.delete(promise));
    }, delay);
  };

  const review = async (file: string, work: ScheduledReview, myEpoch: number, ctx: ExtensionContext): Promise<void> => {
    const { markerDir, target, writer, reviewContext, grant, controller } = work;
    const { config } = reviewContext;
    const ownsWork = () => !closed && myEpoch === epoch && !controller.signal.aborted && scheduled.get(file) === work;
    const sameContext = () =>
      ownsWork() &&
      !changingProjects.has(markerDir) &&
      sessionOwnsProject(ctx, markerDir) &&
      fileInProject(target, file, markerDir) &&
      independentContext(markerDir, writer).signature === reviewContext.signature &&
      sameGrant(grant, findGrant(markerDir, config.reviewer));
    const stillEligible = () => sameContext() && !readPauseInfo(markerDir);

    let retry = false;
    let lockPath: string | undefined;
    try {
      if (!sameContext() || (await pairIsPaused(markerDir)) || !stillEligible()) return;
      const lock = tryAcquireInflightLock(
        markerDir,
        file,
        Math.max(INFLIGHT_TTL_MIN_MS, config.timeoutMs * (config.reviewer === "codex" ? 2 : 1)) + 60_000,
      );
      if (!lock.acquired) {
        if (ownsWork()) {
          retry = true;
          work.firstAt = Date.now();
          armReview(file, work, LOCK_CONTENTION_RETRY_MS, myEpoch, ctx);
        }
        return;
      }
      lockPath = lock.lockPath;

      const rawBuffer = await readFile(file);
      if (!stillEligible() || isBinaryContent(rawBuffer)) return;
      const raw = rawBuffer.toString("utf8");
      const contentHash = hash(raw);
      const { prompt, cacheKey, fingerprint } = reviewInput(file, work.toolName, raw, reviewContext);
      const canCommit = () => {
        try {
          return stillEligible() && hash(readFileSync(file, "utf8")) === contentHash;
        } catch {
          return false;
        }
      };
      const checkEligibility = () => {
        if (!canCommit()) throw new DOMException("Pi review eligibility changed", "AbortError");
      };
      const prior = await readReviewed(markerDir, file);
      if (
        prior?.contentHash === contentHash &&
        prior.review?.fingerprint === fingerprint &&
        fitsReview(config, prior.review)
      )
        return;

      const startedAt = Date.now();
      const hit = await getCachedConcerns(markerDir, cacheKey);
      checkEligibility();
      const cached =
        !!hit &&
        fitsReview(config, hit) &&
        [hit.high, hit.med, hit.low].every((bucket) => bucket.every((body) => typeof body === "string"));
      let reviewResult: Awaited<ReturnType<typeof runReview>>;
      try {
        reviewResult = cached
          ? {
              concerns: hit,
              attribution: { ...reviewAttribution(config, hit.fellBack === true), observedModel: hit.observedModel },
            }
          : await runReview(work, prompt, checkEligibility);
      } catch (error) {
        if ((error instanceof Error && error.name === "AbortError") || !canCommit()) return;
        const reason = errorMessage(error);
        await appendLog(
          markerDir,
          {
            timestamp: new Date().toISOString(),
            tool: work.toolName,
            file,
            verdict: "error",
            source: "pi",
            reviewer: config.reviewer,
            reason: `Pi: ${reason}`,
          },
          canCommit,
        );
        if (!canCommit()) return;
        if (error instanceof CodexQuotaPause) {
          writeAutoPause(markerDir, { kind: "quota", reason });
        } else {
          const failures = recordReviewFailure(markerDir, reason);
          if (failures >= AUTOPAUSE_FAILURE_THRESHOLD) writeAutoPause(markerDir, { kind: "failures", reason });
        }
        notifyRefusal(ctx, `codex-pair review failed. ${reason}`);
        return;
      }

      checkEligibility();
      const { attribution } = reviewResult;
      const concerns = activeConcerns(reviewResult.concerns, readAcks(markerDir));
      const concernHashes = {
        high: concerns.high.map(hashConcernBody),
        med: concerns.med.map(hashConcernBody),
        low: concerns.low.map(hashConcernBody),
      };
      const counts = { high: concerns.high.length, med: concerns.med.length, low: concerns.low.length };
      const decorate = (body: string) => `${body}\n[Acknowledge: /codex-pair-ack ${hashConcernBody(body)} <reason>]`;
      const durationMs = Date.now() - startedAt;
      const message = buildVerdictMessage({
        filePath: file,
        concerns: {
          high: concerns.high.map(decorate),
          med: concerns.med.map(decorate),
          low: concerns.low.map(decorate),
        },
        fellBack: attribution.fellBack,
        durationMs,
        surfaceThreshold: config.surfaceThreshold,
        cached,
        logPath: logPath(markerDir),
      });
      const reviewer = config.reviewer === "codex" ? "Codex" : "Claude";
      const writerLabel = writer.provider && writer.id ? `${writer.provider}/${writer.id}` : "unknown";
      const observed = attribution.observedModel ? `, observed ${attribution.observedModel}` : "";
      const finding: PairFinding = {
        id: randomUUID(),
        file,
        markerDir,
        contentHash,
        message: `Reviewer: ${reviewer} (selected ${attribution.model}${observed}, effort ${
          attribution.reasoningEffort
        }) · Writer: ${writerLabel}\n\n${message}`,
        createdAt: new Date().toISOString(),
        review: { ...attribution, fingerprint, writer, toolName: work.toolName, target, grant },
      };

      // Publish the durable finding before delivery so a host crash can replay its stable ID.
      const path = pendingPath(markerDir, finding.id);
      await mkdir(dirname(path), { recursive: true });
      // Hold the claim across publication so another session cannot drain this
      // finding while this generation is still deciding whether it is current.
      const claimPath = await reserveClaim(path);
      if (!claimPath) return;
      const claimed = { claimPath, pendingPath: path, finding };
      try {
        if (!(await writeJsonAtomic(path, finding, canCommit))) return;
        if (!cached)
          await setCachedConcerns(
            markerDir,
            cacheKey,
            { ...reviewResult.concerns, ...attribution, durationMs },
            canCommit,
          );
        await appendLog(
          markerDir,
          {
            timestamp: finding.createdAt,
            tool: work.toolName,
            file,
            verdict: counts.high + counts.med + counts.low === 0 ? "none" : "concerns",
            source: "pi",
            ...attribution,
            writerProvider: writer.provider,
            writerModel: writer.id,
            contentHash,
            concernHashes,
            cached,
            counts,
            durationMs,
          },
          canCommit,
        );
        if (canCommit()) {
          clearReviewFailures(markerDir);
          await deliverClaimed(claimed, ctx, markerDir);
        } else if (!closed) {
          await consumeClaimed(claimed);
        }
      } finally {
        await releaseClaim(claimed);
      }
    } finally {
      if (!retry) deleteScheduledIfOwned(scheduled, file, work.generation);
      releaseInflightLock(lockPath);
    }
  };

  pi.on("message_end", (event) => {
    const { message } = event;
    if (closed || message.role !== "assistant") return;
    for (const part of message.content) {
      if (part.type === "toolCall" && (part.name === "edit" || part.name === "write")) {
        toolWriters.set(part.id, writerIdentity({ provider: message.provider, id: message.model }));
      }
    }
  });

  pi.on("agent_end", () => {
    toolWriters.clear();
  });

  pi.on("model_select", (event, ctx) => {
    latestWriter = writerIdentity(event.model);
    for (const [file, work] of scheduled) {
      if (work.reviewContext.config.reviewer === writerFamily(latestWriter)) {
        cancelWork(file, work, "Pi selected a model in the reviewer's family");
        notifyRefusal(ctx, "Pi codex-pair cancelled because the selected writer and reviewer share a model family.");
      }
    }
  });

  pi.on("tool_result", (event, ctx) => {
    const writer = toolWriters.get(event.toolCallId) ?? {};
    toolWriters.delete(event.toolCallId);
    if (closed || ctx.mode === "print" || event.isError || (event.toolName !== "edit" && event.toolName !== "write"))
      return;
    const target = normalizeToolPath((event.input as { path?: unknown })?.path, ctx.cwd);
    if (!target || shouldSkip(target)) return;
    const file = canonicalRegularFile(target);
    if (!file) return;
    const previous = scheduled.get(file);
    if (previous) cancelWork(file, previous, "A newer Pi edit replaced this review");
    try {
      const markerDir = findMarkerUp(file);
      if (!markerDir || changingProjects.has(markerDir)) return;
      if (!sessionOwnsProject(ctx, markerDir) || !fileInProject(target, file, markerDir)) {
        notifyRefusal(ctx, "codex-pair is disabled: the edited file is outside Pi's trusted project.");
        return;
      }
      const reviewContext = independentContext(markerDir, writer);
      const { config } = reviewContext;
      const grant = findGrant(markerDir, config.reviewer);
      if (!grant) {
        notifyRefusal(
          ctx,
          `The selected ${
            config.reviewer
          } reviewer is not in your Pi allowlist for this project. Run /codex-pair to consent.`,
        );
        return;
      }
      const now = Date.now();
      const work: ScheduledReview = {
        generation: ++nextGeneration,
        firstAt: previous?.firstAt ?? now,
        markerDir,
        target,
        toolName: event.toolName,
        writer,
        reviewContext,
        grant,
        controller: new AbortController(),
      };
      scheduled.set(file, work);
      const remainingToCap = Math.max(0, config.debounceMaxMs - (now - work.firstAt));
      armReview(file, work, Math.min(config.debounceMs, remainingToCap), epoch, ctx);
    } catch (error) {
      notifyRefusal(ctx, `Pi codex-pair: ${errorMessage(error)}`);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (closed || initializedSessions.has(sessionId) || ctx.mode === "print") return;
    initializedSessions.add(sessionId);
    latestWriter = writerIdentity(ctx.model);
    try {
      const markerDir = findMarkerUp(ctx.cwd);
      if (!markerDir || !sessionOwnsProject(ctx, markerDir)) return;
      const { config } = independentContext(markerDir, {});
      if (!findGrant(markerDir, config.reviewer)) return;
      if (await pairIsPaused(markerDir)) {
        notifyRefusal(ctx, "codex-pair is paused for this project.");
      } else {
        await drainPending(markerDir, ctx);
      }
    } catch (error) {
      notifyRefusal(ctx, `Pi codex-pair: ${errorMessage(error)}`);
    }
  });

  pi.on("session_shutdown", async () => {
    if (closed) return;
    closed = true;
    toolWriters.clear();
    epoch += 1;
    for (const [file, work] of scheduled) cancelWork(file, work, "Pi session shut down");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...active]),
      new Promise<void>((resolveWait) => {
        timeout = setTimeout(resolveWait, 5_000);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  });

  pi.registerCommand("codex-pair", {
    description: "Show Pi codex-pair status, grant reviewer consent, or revoke it",
    handler: async (args, ctx) => {
      try {
        const markerDir = findMarkerUp(ctx.cwd);
        if (!markerDir) {
          notifyRefusal(
            ctx,
            "No .codex-pair/context.md marker found. Run /skill:ask-llm-codex-pair for setup instructions.",
          );
          return;
        }
        if (args.trim() === "revoke") {
          changingProjects.add(markerDir);
          cancelProject(markerDir, "Pi reviewer consent was revoked");
          try {
            await setAllowed(markerDir, false);
          } finally {
            changingProjects.delete(markerDir);
          }
          ctx.ui.notify(`codex-pair consent revoked for ${markerDir}`, "info");
          return;
        }
        const resolved = readConfig(markerDir, {});
        const { config } = resolved;
        const tool = config.reviewer === "codex" ? "Codex CLI" : "Claude CLI";
        const trusted = sessionOwnsProject(ctx, markerDir);
        const allowed = trusted && !!findGrant(markerDir, config.reviewer);
        const status = `${tool} (${config.model}) is ${allowed ? "authorized" : "unauthorized"} for ${markerDir}${
          readPauseInfo(markerDir) ? " (paused)" : ""
        }.`;
        if (args.trim() === "status" || allowed) {
          ctx.ui.notify(status, "info");
          return;
        }
        if (!trusted) {
          notifyRefusal(ctx, `${status} Pi project trust is required before granting reviewer consent.`);
          return;
        }
        if (!ctx.hasUI || ctx.mode !== "tui") {
          notifyRefusal(ctx, `${status} Open Pi in TUI mode and run /codex-pair to consent.`);
          return;
        }
        independentContext(markerDir, writerIdentity(ctx.model));
        const consentEpoch = epoch;
        const projectRevision = projectRevisions.get(markerDir);
        const priorGrant = readAllowlist().projects.find((grant) => grant.root === markerDir);
        const attemptModel =
          config.model +
          (config.reviewer === "codex" && config.fallbackModel !== config.model
            ? ` (quota fallback ${config.fallbackModel})`
            : "");
        const confirmed = await ctx.ui.confirm(
          `Authorize ${tool} as this project's reviewer?`,
          `${tool} will use ${attemptModel} under the ${tool} account configured on this machine. ` +
            `It receives bounded edited-file content and .codex-pair/context.md body (up to ${
              config.maxFileBytes
            } bytes each) and may consume that account's quota or incur charges. Project: ${markerDir}`,
        );
        if (!confirmed) return;
        const canGrant = () => {
          if (
            closed ||
            consentEpoch !== epoch ||
            projectRevision !== projectRevisions.get(markerDir) ||
            changingProjects.has(markerDir) ||
            !sessionOwnsProject(ctx, markerDir)
          )
            return false;
          const currentGrant = readAllowlist().projects.find((grant) => grant.root === markerDir);
          return (
            (priorGrant ? sameGrant(priorGrant, currentGrant) : !currentGrant) &&
            independentContext(markerDir, writerIdentity(ctx.model)).signature === resolved.signature
          );
        };
        if (!canGrant() || !(await setAllowed(markerDir, config.reviewer, canGrant))) {
          notifyRefusal(
            ctx,
            "Pi reviewer settings changed during consent. Run /codex-pair to confirm the current selection.",
          );
          return;
        }
        ctx.ui.notify(`${tool} is authorized for ${markerDir}. Revoke with /codex-pair revoke.`, "info");
      } catch (error) {
        notifyRefusal(ctx, `Pi codex-pair: ${errorMessage(error)}`);
      }
    },
  });

  pi.registerCommand("codex-pair-pause", {
    description: "Pause Pi codex-pair in the current marked project",
    handler: async (_args, ctx) => {
      const markerDir = await findMarkerUp(ctx.cwd);
      if (!markerDir) return notifyRefusal(ctx, "No codex-pair marker found.");
      changingProjects.add(markerDir);
      cancelProject(markerDir, "Pi pairing was paused");
      try {
        await mkdir(stateRoot(markerDir), { recursive: true });
        await writeFile(pausePath(markerDir), "", { flag: "a", mode: 0o600 });
      } finally {
        changingProjects.delete(markerDir);
      }
      ctx.ui.notify("codex-pair paused", "info");
    },
  });

  pi.registerCommand("codex-pair-resume", {
    description: "Resume Pi codex-pair in the current marked project",
    handler: async (_args, ctx) => {
      const markerDir = await findMarkerUp(ctx.cwd);
      if (!markerDir) return notifyRefusal(ctx, "No codex-pair marker found.");
      try {
        await unlink(pausePath(markerDir));
      } catch {}
      clearReviewFailures(markerDir);
      ctx.ui.notify("codex-pair resumed", "info");
    },
  });

  pi.registerCommand("codex-pair-ack", {
    description: "Dismiss a Pi codex-pair finding reminder: /codex-pair-ack <16-char-hash> <reason>",
    handler: async (args, ctx) => {
      const match = args.trim().match(/^([a-f0-9]{16})\s+(.+)$/i);
      if (!match) return notifyRefusal(ctx, "Usage: /codex-pair-ack <16-char-hash> <reason>");
      const markerDir = await findMarkerUp(ctx.cwd);
      if (!markerDir) return notifyRefusal(ctx, "No codex-pair marker found.");
      addAck(markerDir, match[1].toLowerCase(), { reason: match[2] });
      ctx.ui.notify(
        `Acknowledged ${match[1].toLowerCase()} (suppresses that reminder; it does not block reviews).`,
        "info",
      );
    },
  });
}

export const __testing = {
  activeConcerns,
  adaptiveContent,
  allowlistPath,
  claimPending,
  deleteScheduledIfOwned,
  findMarkerUp,
  normalizeToolPath,
  readAllowlist,
  setAllowed,
  shouldSkip,
};
