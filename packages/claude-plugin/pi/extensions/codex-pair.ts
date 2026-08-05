import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { executeCodexCLI } from "@ask-llm/codex-mcp/executor";
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
} from "../../scripts/lib/state.mjs";
import {
  DEFAULT_SURFACE_THRESHOLD,
  buildVerdictMessage,
  parseConcerns,
} from "../../scripts/lib/parser.mjs";

const DEFAULT_DEBOUNCE_MS = 15_000;
const DEFAULT_DEBOUNCE_MAX_MS = 60_000;
const DEFAULT_MAX_FILE_BYTES = 20_000;
const MESSAGE_TYPE = "ask-llm-codex-pair";
const ALLOWLIST_FILE = "codex-pair-projects.json";
const PI_PENDING_DIR = "pi-pending";
const PI_REVIEWED_DIR = "pi-reviewed";
const SKIP_PARTS = [
  "/.git/",
  "/node_modules/",
  "/dist/",
  "/build/",
  "/.next/",
  "/coverage/",
  "/.codex-pair/",
];
const SKIP_SUFFIXES = [
  ".lock",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".zip",
  ".gz",
];

interface PairConfig {
  debounceMs: number;
  debounceMaxMs: number;
  maxFileBytes: number;
  surfaceThreshold: "high" | "med" | "low";
  model: string;
}

interface ScheduledReview {
  generation: number;
  firstAt: number;
  markerDir: string;
  toolName: string;
  timer?: ReturnType<typeof setTimeout>;
}

interface PairFinding {
  id: string;
  file: string;
  markerDir: string;
  contentHash: string;
  message: string;
  createdAt: string;
}

interface ReviewedRecord {
  contentHash: string;
  findingId: string;
  deliveredAt: string;
}

interface Allowlist {
  version: 1;
  projects: Array<{ root: string; allowedAt: string }>;
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

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${randomUUID()}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

async function readAllowlist(): Promise<Allowlist> {
  try {
    const parsed = JSON.parse(await readFile(allowlistPath(), "utf8")) as Partial<Allowlist>;
    if (parsed.version === 1 && Array.isArray(parsed.projects)) {
      return {
        version: 1,
        projects: parsed.projects.filter(
          (entry): entry is { root: string; allowedAt: string } =>
            typeof entry?.root === "string" && typeof entry.allowedAt === "string",
        ),
      };
    }
  } catch {}
  return { version: 1, projects: [] };
}

async function canonicalDirectory(path: string): Promise<string> {
  return realpath(path);
}

async function isAllowed(markerDir: string): Promise<boolean> {
  const canonical = await canonicalDirectory(markerDir);
  return (await readAllowlist()).projects.some((entry) => entry.root === canonical);
}

async function setAllowed(markerDir: string, allowed: boolean): Promise<void> {
  const canonical = await canonicalDirectory(markerDir);
  const current = await readAllowlist();
  const projects = current.projects.filter((entry) => entry.root !== canonical);
  if (allowed) projects.push({ root: canonical, allowedAt: new Date().toISOString() });
  await writeJsonAtomic(allowlistPath(), { version: 1, projects } satisfies Allowlist);
}

async function findMarkerUp(start: string): Promise<string | undefined> {
  let current = start;
  try {
    const info = await stat(current);
    if (!info.isDirectory()) current = dirname(current);
  } catch {
    current = dirname(current);
  }
  current = resolve(current);
  const root = parse(current).root;
  for (let depth = 0; depth < 40; depth++) {
    if (existsSync(join(current, ".codex-pair", "context.md"))) return canonicalDirectory(current);
    if (current === root) break;
    current = dirname(current);
  }
  return undefined;
}

function parseNumberFrontmatter(content: string, key: string, fallback: number): number {
  const match = content.match(new RegExp(`^${key}:\\s*(\\d+)\\s*$`, "m"));
  const value = match ? Number(match[1]) : fallback;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function readConfig(markerDir: string): Promise<{ config: PairConfig; context: string }> {
  const context = await readFile(join(markerDir, ".codex-pair", "context.md"), "utf8");
  const threshold = context.match(/^surfaceThreshold:\s*(high|med|low)\s*$/m)?.[1];
  const model = context.match(/^model:\s*([^\n]+)$/m)?.[1]?.trim() || "gpt-5.6-sol";
  return {
    context,
    config: {
      debounceMs: parseNumberFrontmatter(context, "debounceMs", DEFAULT_DEBOUNCE_MS),
      debounceMaxMs: parseNumberFrontmatter(context, "debounceMaxMs", DEFAULT_DEBOUNCE_MAX_MS),
      maxFileBytes: parseNumberFrontmatter(context, "maxFileBytes", DEFAULT_MAX_FILE_BYTES),
      surfaceThreshold: (threshold as PairConfig["surfaceThreshold"] | undefined) ?? DEFAULT_SURFACE_THRESHOLD,
      model,
    },
  };
}

function normalizeToolPath(inputPath: unknown, cwd: string): string | undefined {
  if (typeof inputPath !== "string" || inputPath.trim().length === 0) return undefined;
  const withoutAt = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
  return isAbsolute(withoutAt) ? resolve(withoutAt) : resolve(cwd, withoutAt);
}

async function canonicalRegularFile(path: string): Promise<string | undefined> {
  try {
    const canonical = await realpath(path);
    return (await stat(canonical)).isFile() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

function shouldSkip(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return SKIP_PARTS.some((part) => normalized.includes(part)) || SKIP_SUFFIXES.some((part) => normalized.endsWith(part));
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

async function persistFinding(finding: PairFinding): Promise<void> {
  await writeJsonAtomic(pendingPath(finding.markerDir, finding.id), finding);
  await writeJsonAtomic(reviewedPath(finding.markerDir, finding.file), {
    contentHash: finding.contentHash,
    findingId: finding.id,
    deliveredAt: finding.createdAt,
  } satisfies ReviewedRecord);
}

async function clearPending(finding: PairFinding): Promise<void> {
  try {
    await unlink(pendingPath(finding.markerDir, finding.id));
  } catch {}
}

function sendFinding(pi: ExtensionAPI, finding: PairFinding): void {
  pi.sendMessage(
    {
      customType: MESSAGE_TYPE,
      content: `${finding.message}\n\nPi note: findings are advisory and non-blocking; Pi has no safe Claude Stop-gate equivalent.`,
      display: true,
      details: { file: finding.file, project: finding.markerDir, findingId: finding.id },
    },
    { deliverAs: "steer", triggerTurn: false },
  );
}

async function listPending(markerDir: string): Promise<PairFinding[]> {
  const root = join(stateRoot(markerDir), PI_PENDING_DIR);
  try {
    const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
    const findings: PairFinding[] = [];
    for (const name of names.slice(0, 8)) {
      try {
        findings.push(JSON.parse(await readFile(join(root, name), "utf8")) as PairFinding);
      } catch {}
    }
    return findings;
  } catch {
    return [];
  }
}

async function adaptiveContent(content: string, maxBytes: number): Promise<{ content: string; partial: boolean }> {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) return { content, partial: false };
  const chars = Math.max(1000, Math.floor(maxBytes / 2));
  return {
    content: `${content.slice(0, chars)}\n\n[... middle omitted by codex-pair size bound ...]\n\n${content.slice(-chars)}`,
    partial: true,
  };
}

function activeConcerns(
  concerns: { high: string[]; med: string[]; low: string[] },
  acks: Record<string, unknown>,
): { high: string[]; med: string[]; low: string[] } {
  const prepare = (body: string) => {
    const concernHash = hashConcernBody(body);
    return concernHash in acks ? undefined : `${body}\n[Acknowledge: /codex-pair-ack ${concernHash} <reason>]`;
  };
  return {
    high: concerns.high.map(prepare).filter((body): body is string => body !== undefined),
    med: concerns.med.map(prepare).filter((body): body is string => body !== undefined),
    low: concerns.low.map(prepare).filter((body): body is string => body !== undefined),
  };
}

function isQuotaError(error: unknown): boolean {
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return ["quota", "usage limit", "rate limit", "429", "insufficient_quota"].some((part) => text.includes(part));
}

export function registerCodexPair(pi: ExtensionAPI): void {
  const scheduled = new Map<string, ScheduledReview>();
  const active = new Set<Promise<void>>();
  const controllers = new Set<AbortController>();
  let closed = false;
  let epoch = 0;
  const initializedSessions = new Set<string>();

  const notifyRefusal = (ctx: ExtensionContext, message: string) => {
    if (ctx.hasUI) ctx.ui.notify(message, "warning");
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

  const deliver = async (finding: PairFinding) => {
    if (closed) return;
    sendFinding(pi, finding);
    await clearPending(finding);
  };

  const schedule = async (file: string, markerDir: string, toolName: string, ctx: ExtensionContext) => {
    if (closed || ctx.mode === "print") return;
    const now = Date.now();
    const previous = scheduled.get(file);
    if (previous?.timer) clearTimeout(previous.timer);
    const next: ScheduledReview = {
      generation: (previous?.generation ?? 0) + 1,
      firstAt: previous?.firstAt ?? now,
      markerDir,
      toolName,
    };
    scheduled.set(file, next);
    const { config } = await readConfig(markerDir);
    const remainingToCap = Math.max(0, config.debounceMaxMs - (now - next.firstAt));
    const delay = Math.min(config.debounceMs, remainingToCap);
    const myEpoch = epoch;
    next.timer = setTimeout(() => {
      next.timer = undefined;
      const promise = review(file, next.generation, myEpoch, ctx).catch(async (error) => {
        if (closed || error?.name === "AbortError") return;
        const reason = error instanceof Error ? error.message : String(error);
        await appendLog(markerDir, {
          timestamp: new Date().toISOString(),
          tool: toolName,
          file,
          verdict: "error",
          reason: `Pi: ${reason}`,
        });
        if (isQuotaError(error)) {
          writeAutoPause(markerDir, { kind: "quota", reason });
        } else {
          const failures = recordReviewFailure(markerDir, reason);
          if (failures >= AUTOPAUSE_FAILURE_THRESHOLD) writeAutoPause(markerDir, { kind: "failures", reason });
        }
        notifyRefusal(ctx, `codex-pair review failed: ${reason}`);
      });
      active.add(promise);
      promise.finally(() => active.delete(promise));
    }, delay);
  };

  const review = async (file: string, generation: number, myEpoch: number, ctx: ExtensionContext): Promise<void> => {
    if (closed || myEpoch !== epoch) return;
    const work = scheduled.get(file);
    if (!work || work.generation !== generation) return;
    if (!ctx.isProjectTrusted() || !(await isAllowed(work.markerDir)) || (await pairIsPaused(work.markerDir))) return;

    const { config, context } = await readConfig(work.markerDir);
    const lock = tryAcquireInflightLock(
      work.markerDir,
      file,
      Math.max(INFLIGHT_TTL_MIN_MS, Number(process.env.ASK_CODEX_TIMEOUT_MS ?? 800_000)) + 60_000,
    );
    if (!lock.acquired) {
      work.firstAt = Date.now();
      await schedule(file, work.markerDir, work.toolName, ctx);
      return;
    }

    try {
      const raw = await readFile(file, "utf8");
      const contentHash = hash(raw);
      if ((await readReviewed(work.markerDir, file))?.contentHash === contentHash) {
        scheduled.delete(file);
        return;
      }
      const view = await adaptiveContent(raw, config.maxFileBytes);
      const { buildReviewPrompt } = await import("../../scripts/lib/prompt.mjs");
      const prompt = buildReviewPrompt({
        filePath: file,
        fileContent: view.content,
        toolName: `Pi ${work.toolName}`,
        projectContext: context,
        partialView: view.partial,
      });
      const cacheKey = computeCacheKey({
        model: config.model,
        prompt,
        fileContent: view.content,
        surfaceThreshold: config.surfaceThreshold,
      });
      const startedAt = Date.now();
      let concerns = await getCachedConcerns(work.markerDir, cacheKey);
      let fellBack = false;
      let cached = true;
      if (!concerns) {
        cached = false;
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const result = await executeCodexCLI({
            prompt,
            model: config.model,
            sandbox: "read-only",
            signal: controller.signal,
          });
          concerns = parseConcerns(result.response);
          fellBack = result.usage?.fellBack ?? false;
          await setCachedConcerns(work.markerDir, cacheKey, {
            ...concerns,
            durationMs: Date.now() - startedAt,
          });
        } finally {
          controllers.delete(controller);
        }
      }
      if (closed || myEpoch !== epoch) return;
      const latest = await readFile(file, "utf8");
      if (hash(latest) !== contentHash) {
        work.firstAt = Date.now();
        await schedule(file, work.markerDir, work.toolName, ctx);
        return;
      }
      concerns = activeConcerns(concerns, readAcks(work.markerDir));
      clearReviewFailures(work.markerDir);
      const durationMs = Date.now() - startedAt;
      const message = buildVerdictMessage({
        filePath: file,
        concerns,
        fellBack,
        durationMs,
        surfaceThreshold: config.surfaceThreshold,
        cached,
        logPath: logPath(work.markerDir),
      });
      const finding: PairFinding = {
        id: randomUUID(),
        file,
        markerDir: work.markerDir,
        contentHash,
        message,
        createdAt: new Date().toISOString(),
      };
      await appendLog(work.markerDir, {
        timestamp: finding.createdAt,
        tool: work.toolName,
        file,
        verdict: concerns.high.length + concerns.med.length + concerns.low.length === 0 ? "none" : "concerns",
        source: "pi",
        fellBack,
        cached,
        counts: { high: concerns.high.length, med: concerns.med.length, low: concerns.low.length },
        durationMs,
      });
      await persistFinding(finding);
      scheduled.delete(file);
      await deliver(finding);
    } finally {
      releaseInflightLock(lock.lockPath);
    }
  };

  pi.on("tool_result", async (event, ctx) => {
    if (closed || event.isError || (event.toolName !== "edit" && event.toolName !== "write")) return;
    const target = normalizeToolPath((event.input as { path?: unknown })?.path, ctx.cwd);
    if (!target || shouldSkip(target)) return;
    const file = await canonicalRegularFile(target);
    if (!file) return;
    const markerDir = await findMarkerUp(file);
    if (!markerDir) return;
    if (!ctx.isProjectTrusted()) {
      notifyRefusal(ctx, "codex-pair is disabled: Pi does not trust this project.");
      return;
    }
    if (!(await isAllowed(markerDir))) {
      notifyRefusal(ctx, "codex-pair marker found, but this project is not in your Pi allowlist. Run /codex-pair to consent.");
      return;
    }
    await schedule(file, markerDir, event.toolName, ctx);
  });

  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (initializedSessions.has(sessionId)) return;
    initializedSessions.add(sessionId);
    if (ctx.mode === "print") return;
    const markerDir = await findMarkerUp(ctx.cwd);
    if (!markerDir || !ctx.isProjectTrusted() || !(await isAllowed(markerDir))) return;
    for (const finding of await listPending(markerDir)) await deliver(finding);
    if (await pairIsPaused(markerDir)) notifyRefusal(ctx, "codex-pair is paused for this project.");
  });

  pi.on("session_shutdown", async () => {
    if (closed) return;
    closed = true;
    epoch += 1;
    for (const work of scheduled.values()) if (work.timer) clearTimeout(work.timer);
    scheduled.clear();
    for (const controller of controllers) controller.abort(new DOMException("Pi session shut down", "AbortError"));
    controllers.clear();
    await Promise.race([
      Promise.allSettled([...active]),
      new Promise<void>((resolveWait) => setTimeout(resolveWait, 5_000)),
    ]);
  });

  pi.registerCommand("codex-pair", {
    description: "Show Pi codex-pair status, grant explicit project consent, or revoke it",
    handler: async (args, ctx) => {
      const markerDir = await findMarkerUp(ctx.cwd);
      if (!markerDir) {
        notifyRefusal(ctx, "No .codex-pair/context.md marker found. Run /skill:codex-pair for setup instructions.");
        return;
      }
      if (args.trim() === "revoke") {
        await setAllowed(markerDir, false);
        ctx.ui.notify(`codex-pair consent revoked for ${markerDir}`, "info");
        return;
      }
      if (!ctx.isProjectTrusted()) {
        notifyRefusal(ctx, "Project trust is required before codex-pair can be enabled.");
        return;
      }
      if (await isAllowed(markerDir)) {
        ctx.ui.notify(`codex-pair is allowed for ${markerDir}${(await pairIsPaused(markerDir)) ? " (paused)" : ""}`, "info");
        return;
      }
      if (!ctx.hasUI) {
        notifyRefusal(ctx, "Consent requires interactive Pi. Open Pi in TUI mode and run /codex-pair.");
        return;
      }
      const confirmed = await ctx.ui.confirm(
        "Enable codex-pair for this project?",
        `This sends bounded edited-file content and .codex-pair/context.md to the Codex CLI account configured on this machine and may consume subscription quota. Project: ${markerDir}`,
      );
      if (!confirmed) return;
      await setAllowed(markerDir, true);
      ctx.ui.notify(`codex-pair enabled for ${markerDir}. Revoke with /codex-pair revoke.`, "info");
    },
  });

  pi.registerCommand("codex-pair-pause", {
    description: "Pause Pi codex-pair in the current marked project",
    handler: async (_args, ctx) => {
      const markerDir = await findMarkerUp(ctx.cwd);
      if (!markerDir) return notifyRefusal(ctx, "No codex-pair marker found.");
      await mkdir(stateRoot(markerDir), { recursive: true });
      await writeFile(pausePath(markerDir), "", { flag: "a", mode: 0o600 });
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
      ctx.ui.notify(`Acknowledged ${match[1].toLowerCase()} (suppresses that reminder; it does not block reviews).`, "info");
    },
  });
}

export const __testing = {
  activeConcerns,
  adaptiveContent,
  findMarkerUp,
  normalizeToolPath,
  readAllowlist,
  setAllowed,
  shouldSkip,
};
