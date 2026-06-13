#!/usr/bin/env node
// codex-pair-watch — production version of the POC hook.
//
// PostToolUse hook on Edit|Write|MultiEdit. The hook is always loaded but
// SELF-GATES on the presence of a `.codex-pair/context.md` marker file
// somewhere on the path from cwd up to the project root (ADR-092
// consolidates all hook state under `.codex-pair/`). No marker → exit
// silently (zero codex calls, zero cost). With marker → file is reviewed
// per the v2 prompt design (HIGH/MED/LOW grading, surface HIGH+MED, log all).
//
// Empirical justification: ADR-077. Four benchmark tasks documented on
// branch `experiment/codex-pair-poc`.
//
// Why no workspace imports: this script ships via marketplace as part of a
// `git-subdir` extraction with no `npm install` step, so workspace deps
// (`ask-codex-mcp/executor`, `@ask-llm/shared`) don't resolve. The codex
// invocation is inlined; semantics mirror `codexExecutor.ts` deliberately.

import { spawn } from "node:child_process";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { IS_WINDOWS, terminateProcessTree } from "./lib/process.mjs";
// M4: broker integration. Importing initializeBroker + isBrokerEnabled +
// submitReview from broker.mjs transitively pulls in broker-transport,
// broker-rpc, broker-lifecycle. ESM-static cost is paid on every hook
// fire, but isBrokerEnabled returns false fast when ASK_CODEX_BROKER
// isn't set, so the per-edit fast path is unaffected.
import { initializeBroker, isBrokerEnabled, readBrokerState, submitReview } from "./lib/broker.mjs";
import {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_DEBOUNCE_MAX_MS,
  bumpEditRecord,
  drainPending,
  joinPendingForSurface,
  sweepStaleDebounce,
} from "./lib/debounce-state.mjs";
import { buildReviewPrompt } from "./lib/prompt.mjs";
import {
  buildVerdictMessage,
  DEFAULT_SURFACE_THRESHOLD,
  formatDuration,
  parseConcerns,
  VALID_THRESHOLDS,
  VERDICT_PREFIXES,
} from "./lib/parser.mjs";
import {
  appendLog,
  computeCacheKey,
  CONTEXT_FILENAME,
  contextPath,
  getBlockingFromShard,
  getCachedConcerns,
  hashConcernBody,
  ignorePath,
  includePath,
  INFLIGHT_TTL_MIN_MS,
  isPaused,
  logPath,
  PAIR_ROOT_DIR,
  releaseInflightLock,
  setCachedConcerns,
  tryAcquireInflightLock,
  updateRepetitions,
} from "./lib/state.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULTS_PATH = join(SCRIPT_DIR, "..", "codex-pair-defaults.json");

// codex-pair-defaults.json carries the canonical default + fallback model
// names so the hook stays in sync with codex-mcp/src/constants.ts:MODELS
// without duplicating literals across files. A structural test links the
// JSON values to constants.ts so drift fails CI. If the file is missing or
// malformed, fall through to env vars and hardcoded literals.
let CODEX_PAIR_DEFAULTS = { model: "gpt-5.5", fallbackModel: "gpt-5.5-mini" };
try {
  CODEX_PAIR_DEFAULTS = JSON.parse(readFileSync(DEFAULTS_PATH, "utf8"));
} catch {
  // intentional fallback to inline defaults
}

// ADR-092: marker is the consolidated `.codex-pair/context.md` path. The
// hook walks up looking for this nested file (presence enables review,
// content is the project context sent to codex).
const MARKER_FILE = join(PAIR_ROOT_DIR, CONTEXT_FILENAME);
const WATCHED_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);
const DEFAULT_MODEL = process.env.ASK_CODEX_MODEL ?? CODEX_PAIR_DEFAULTS.model;
const FALLBACK_MODEL = process.env.ASK_CODEX_FALLBACK_MODEL ?? CODEX_PAIR_DEFAULTS.fallbackModel;
const DEFAULT_TIMEOUT_MS = Number(process.env.ASK_CODEX_TIMEOUT_MS ?? 800_000);
const MAX_FILE_BYTES = Number(process.env.CODEX_PAIR_MAX_FILE_BYTES ?? 20_000);
const DEBOUNCE_MS = Number(process.env.ASK_CODEX_DEBOUNCE_MS ?? DEFAULT_DEBOUNCE_MS);
const DEBOUNCE_MAX_MS = Number(process.env.ASK_CODEX_DEBOUNCE_MAX_MS ?? DEFAULT_DEBOUNCE_MAX_MS);
const QUOTA_SIGNALS = [
  "rate_limit_exceeded",
  "quota_exceeded",
  "429",
  "insufficient_quota",
  // ChatGPT-plan phrasings (#176) — API-style signals above never match these.
  "usage limit",
  "rate limit",
];

// Transient failure signatures (item #10). Errors matching any of these get
// ONE retry with jittered delay before propagating. Quota errors take the
// existing model-fallback path (not retry — quota exhaustion isn't transient).
// Hook-side timeouts and JSONL parse failures are excluded by verdict tag
// (see isTransientError) — those are deterministic failures that retry can't fix.
const TRANSIENT_SIGNALS = [
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /EAI_AGAIN/,
  /UND_ERR/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
];

// Cache, log, pause, and inflight-lock state live in ./lib/state.mjs.
// The hook imports computeCacheKey, getCachedConcerns, setCachedConcerns,
// appendLog, isPaused, tryAcquireInflightLock, releaseInflightLock, and
// INFLIGHT_TTL_MIN_MS at the top of this file.

// Marker-walk anchor for the unhandled-exception catch handler. main() sets
// this to `dirname(filePath)` once the payload is validated; the catch
// handler at the bottom of the file reads it to write diagnostics into the
// correct repo's log (the edited file's repo, not cwd's). If main() throws
// before payload parsing, this stays null and the catch falls back to cwd.
// See multi-review feedback on PR #76 — both Gemini and Codex flagged the
// previous cwd-only catch path as a residual cross-repo gap.
let markerAnchor = null;

// Closed verdict set + presentation prefixes live in ./lib/parser.mjs
// (VERDICT_PREFIXES). The hook imports them at the top.

const SKIP_PATTERNS = [
  // Path patterns — leading/trailing slash guards against substring matches
  "/node_modules/",
  "/dist/",
  "/.git/",
  // Lockfiles by exact filename
  "yarn.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "go.sum",
  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  // Fonts
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  // Documents + archives
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  // Snapshots, sourcemaps, minified assets
  ".snap",
  ".map",
  ".min.js",
  ".min.css",
  // Generic .lock catch-all (matches anything ending in .lock)
  ".lock",
];

async function readStdin() {
  return new Promise((resolveRead) => {
    let data = "";
    process.stdin.on("data", (chunk) => {
      data += chunk.toString();
    });
    process.stdin.on("end", () => resolveRead(data));
    process.stdin.on("error", () => resolveRead(""));
  });
}

// Surface a one-line (or multi-line) notice to the Claude Code UI by emitting
// hook JSON to stdout. Claude Code parses `systemMessage` and renders it as an
// inline transcript message. We await the write-callback so the bytes are
// flushed to the parent before process.exit terminates us.
function emitSystemMessage(text) {
  return new Promise((resolveWrite) => {
    const payload = JSON.stringify({ continue: true, systemMessage: text });
    process.stdout.write(`${payload}\n`, () => resolveWrite());
  });
}

// formatDuration + buildVerdictMessage live in ./lib/parser.mjs.

// Zero-dependency YAML frontmatter parser. Recognizes an opening `---` on
// line 1, parses flat key:value lines, stops at the closing `---`. No nested
// structures, no arrays, no multi-line values. Returns { frontmatter, body,
// malformed }. `malformed` flips true when an opener exists with no closer —
// the caller can log a warning and fall through to defaults.
function parseFrontmatter(content) {
  if (typeof content !== "string" || content.length === 0) {
    return { frontmatter: {}, body: "", malformed: false };
  }
  const firstNewline = content.indexOf("\n");
  if (firstNewline === -1) return { frontmatter: {}, body: content, malformed: false };
  const opener = content.slice(0, firstNewline).replace(/\r$/, "");
  if (opener !== "---") return { frontmatter: {}, body: content, malformed: false };

  const rest = content.slice(firstNewline + 1);
  const closerMatch = rest.match(/^---\s*$/m);
  if (!closerMatch || typeof closerMatch.index !== "number") {
    return { frontmatter: {}, body: content, malformed: true };
  }

  const fmText = rest.slice(0, closerMatch.index);
  let body = rest.slice(closerMatch.index + closerMatch[0].length);
  if (body.startsWith("\r")) body = body.slice(1);
  if (body.startsWith("\n")) body = body.slice(1);

  const frontmatter = {};
  for (const rawLine of fmText.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (key.length === 0) continue;
    let valueRaw = line.slice(colon + 1);
    // Strip inline comment, but only when `#` follows whitespace.
    const inlineComment = valueRaw.match(/\s+#.*$/);
    if (inlineComment && typeof inlineComment.index === "number") {
      valueRaw = valueRaw.slice(0, inlineComment.index);
    }
    let value = valueRaw.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === "true") frontmatter[key] = true;
    else if (value === "false") frontmatter[key] = false;
    else if (/^-?\d+$/.test(value)) frontmatter[key] = Number(value);
    else if (/^-?\d+\.\d+$/.test(value)) frontmatter[key] = Number(value);
    else frontmatter[key] = value;
  }
  return { frontmatter, body, malformed: false };
}

// Spawn `git diff -U<n> HEAD -- <filePath>` with a hard timeout. Returns the
// diff output as a string, or null on any failure (not a repo, untracked file,
// git binary missing, timeout, non-zero exit). Never throws. Process-tree
// termination is provided by ./lib/process.mjs (ADR-084 / ADR-088).
function runGitDiff({ filePath, contextLines, cwd, timeoutMs }) {
  return new Promise((resolveDiff) => {
    let stdout = "";
    let settled = false;
    const child = spawn("git", ["diff", `-U${contextLines}`, "HEAD", "--", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
      // detached:true on POSIX makes the child a process-group leader so
      // terminateProcessTree can reach grandchildren via negative-PID kill.
      detached: !IS_WINDOWS,
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", () => {
      // discard stderr — we only care about successful diff output
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminateProcessTree(child, "SIGTERM");
      resolveDiff(null);
    }, timeoutMs);
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveDiff(null);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 && stdout.length > 0) {
        resolveDiff(stdout);
      } else {
        resolveDiff(null);
      }
    });
  });
}

// Build a partial-view payload for files that exceed the size cap. Three modes:
//   - "diff": file is tracked in git and `git diff -U20` returned something
//     useful. Sends `header-80-lines + diff-against-HEAD`.
//   - "head-tail": file is untracked, git unavailable, or diff was too large.
//     Sends `head-150 + omission marker + tail-80`.
//   - "truncated": file has few lines but is still over the byte cap (e.g.,
//     one massive minified line). Sends a hard-truncated slice.
// Caller is responsible for the `partialView: true` flag on `buildPrompt`.
async function buildAdaptiveContext({ filePath, fileContent, markerDir, maxFileBytes }) {
  const diff = await runGitDiff({
    filePath,
    contextLines: 20,
    cwd: markerDir,
    timeoutMs: 5000,
  });
  const headerLines = fileContent.split("\n").slice(0, 80);
  const headerText = headerLines.join("\n");
  if (diff && Buffer.byteLength(diff, "utf8") < maxFileBytes) {
    return {
      strategy: "diff",
      content: `<file_header_first_80_lines>\n${headerText}\n</file_header_first_80_lines>\n\n<diff_against_head>\n${diff}\n</diff_against_head>`,
    };
  }
  const lines = fileContent.split("\n");
  if (lines.length <= 230) {
    const truncated = fileContent.slice(0, maxFileBytes);
    return {
      strategy: "truncated",
      content: `<file_partial_view_truncated>\n${truncated}\n[... rest of file truncated due to size cap ...]\n</file_partial_view_truncated>`,
    };
  }
  const head = lines.slice(0, 150).join("\n");
  const tail = lines.slice(-80).join("\n");
  const omitted = lines.length - 230;
  return {
    strategy: "head-tail",
    content: `<file_head_first_150_lines>\n${head}\n</file_head_first_150_lines>\n\n[... ${omitted} lines omitted ...]\n\n<file_tail_last_80_lines>\n${tail}\n</file_tail_last_80_lines>`,
  };
}

// isPaused, inflightLockPath, tryAcquireInflightLock, releaseInflightLock
// all live in ./lib/state.mjs.

// Read `.codex-pair/ignore` from the marker directory if present. Returns an
// array of rule objects in declaration order. Missing file / read error →
// empty array. Comments (`#` lines) and blank lines are filtered out. Each
// rule carries `{ negate, pattern, raw }`. Per-project, single file — no
// nested ignore-file traversal in subdirs (the marker is the project anchor).
// Generic gitignore-style rule parser used for BOTH .codex-pair/ignore
// (ADR-081 exclusion-list) AND .codex-pair/include (ADR-096 inclusion-list).
function readGlobRulesFile(absolutePath) {
  let content;
  try {
    content = readFileSync(absolutePath, "utf8");
  } catch {
    return [];
  }
  const rules = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    const pattern = negate ? line.slice(1) : line;
    if (pattern.length === 0) continue;
    rules.push({ negate, pattern, raw: line });
  }
  return rules;
}

function readIgnoreFile(markerDir) {
  return readGlobRulesFile(ignorePath(markerDir));
}

// ADR-096: inclusion-list mirror of ignore-list. When `.codex-pair/include`
// exists AND has at least one non-comment rule, ONLY files matching at
// least one rule are reviewed. Empty/missing = no scoping (review everything).
function readIncludeFile(markerDir) {
  return readGlobRulesFile(includePath(markerDir));
}

// Convert a gitignore-style glob into a JS RegExp. Handles `*` (any chars
// except `/`), `**` (any chars including `/`), `?` (single char except `/`),
// `[abc]` character class, leading `/` anchors to marker dir, trailing `/`
// matches directory contents. Does NOT support the full gitignore spec —
// the common cases work; weird precedence edge cases are out of scope.
function globToRegex(pattern) {
  const anchored = pattern.startsWith("/");
  const trailingSlash = pattern.endsWith("/");
  let p = anchored ? pattern.slice(1) : pattern;
  if (trailingSlash) p = p.slice(0, -1);
  let body = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        body += ".*";
        i++;
        if (p[i + 1] === "/") i++;
      } else {
        body += "[^/]*";
      }
    } else if (c === "?") {
      body += "[^/]";
    } else if (c === "[") {
      const end = p.indexOf("]", i);
      if (end === -1) {
        body += "\\[";
      } else {
        body += p.slice(i, end + 1);
        i = end;
      }
    } else if ("().+|^$\\".includes(c)) {
      body += `\\${c}`;
    } else {
      body += c;
    }
  }
  const prefix = anchored ? "^" : "(^|.*/)";
  const suffix = "(/.*)?$";
  return new RegExp(prefix + body + suffix);
}

// Walk rules in declaration order; the last matching rule wins. If that last
// matching rule is a negation (!pattern), the file is NOT ignored. Returns
// the matching rule object or null if no rule matches (or final match is a
// negation). `filePath` is normalized to a marker-relative path.
function matchesIgnoreRule(filePath, markerDir, rules) {
  if (rules.length === 0) return null;
  let rel = filePath;
  const prefix = `${markerDir}/`;
  if (filePath.startsWith(prefix)) {
    rel = filePath.slice(prefix.length);
  }
  let lastMatch = null;
  for (const rule of rules) {
    if (globToRegex(rule.pattern).test(rel)) {
      lastMatch = rule;
    }
  }
  if (lastMatch && lastMatch.negate) return null;
  return lastMatch;
}

// Resolve runtime config per-marker. Precedence: frontmatter > env > default.
// Invalid types in frontmatter are silently ignored (fall through to env/default).
function resolveConfig(frontmatter) {
  const fm = frontmatter ?? {};
  const surfaceCandidate = typeof fm.surfaceThreshold === "string" ? fm.surfaceThreshold : null;
  return {
    model: typeof fm.model === "string" && fm.model.length > 0 ? fm.model : DEFAULT_MODEL,
    fallbackModel:
      typeof fm.fallbackModel === "string" && fm.fallbackModel.length > 0
        ? fm.fallbackModel
        : FALLBACK_MODEL,
    timeoutMs:
      typeof fm.timeoutMs === "number" && fm.timeoutMs > 0 ? fm.timeoutMs : DEFAULT_TIMEOUT_MS,
    maxFileBytes:
      typeof fm.maxFileBytes === "number" && fm.maxFileBytes > 0
        ? fm.maxFileBytes
        : MAX_FILE_BYTES,
    surfaceThreshold:
      surfaceCandidate && VALID_THRESHOLDS.has(surfaceCandidate)
        ? surfaceCandidate
        : DEFAULT_SURFACE_THRESHOLD,
    debounceMs:
      typeof fm.debounceMs === "number" && fm.debounceMs >= 0 ? fm.debounceMs : DEBOUNCE_MS,
    debounceMaxMs:
      typeof fm.debounceMaxMs === "number" && fm.debounceMaxMs > 0 ? fm.debounceMaxMs : DEBOUNCE_MAX_MS,
  };
}

// Walks up from `startDir` looking for `<dir>/.codex-pair/context.md`.
// Returns the PROJECT ROOT (the directory that holds `.codex-pair/`) or
// null when nothing is found within 20 levels or once we hit $HOME.
async function findMarkerUp(startDir) {
  const home = homedir();
  let current = resolve(startDir);
  for (let depth = 0; depth < 20; depth++) {
    const candidate = join(current, MARKER_FILE);
    try {
      await access(candidate);
      return current;
    } catch {
      // not found at this level
    }
    const parent = dirname(current);
    if (parent === current) return null;
    if (current === home) return null;
    current = parent;
  }
  return null;
}

// ADR-089: the prompt template is now externalized at prompts/review.txt and
// rendered by ./lib/prompt.mjs. The hook keeps `buildPrompt` as a thin
// pass-through so callers don't change — and so structural tests that pin
// the call site stay readable.
function buildPrompt(args) {
  return buildReviewPrompt(args);
}

// ADR-083 JSON-first parser (tryExtractJson, parseConcernsJson,
// parseConcernsLegacy, parseConcerns, formatFindingBody) lives in
// ./lib/parser.mjs and is imported at the top of this file.

// Cache + log helpers (computeCacheKey/cachePathFor/getCachedConcerns/
// setCachedConcerns/evictCacheOldest/rotateLogIfNeeded/clampReason/appendLog)
// all live in ./lib/state.mjs.

// Build codex CLI args. Mirrors packages/codex-mcp/src/utils/codexExecutor.ts
// `buildArgs` for the no-session, stdin-prompt case (hook always passes prompt
// via stdin to avoid ARG_MAX limits on file-content-heavy prompts).
function buildCodexArgs(model) {
  const args = ["exec", "--skip-git-repo-check", "--ephemeral"];
  if (process.env.ASK_CODEX_LOAD_USER_CONFIG !== "1") {
    args.push("--ignore-user-config", "--ignore-rules");
  }
  args.push("--sandbox", "workspace-write", "--json", "-m", model);
  return args;
}

// Parse codex `--json` JSONL stdout. Pulled from `codexExecutor.ts`
// `parseCodexJsonlOutput`: the agent's final answer is the last
// `item.completed` event whose `item.type === "agent_message"`.
function parseCodexJsonl(stdout) {
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  let lastAgentMessage;
  let lastError;
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed?.type === "item.completed") {
      const item = parsed.item;
      if (item?.type === "agent_message" && typeof item.text === "string" && item.text.length > 0) {
        lastAgentMessage = item.text;
      }
    }
    if (parsed?.type === "error") {
      lastError = JSON.stringify(parsed);
    }
  }
  if (lastError && !lastAgentMessage) {
    throw new Error(`Codex error event: ${lastError}`);
  }
  return lastAgentMessage ?? stdout;
}

function isQuotaError(err) {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return QUOTA_SIGNALS.some((sig) => msg.includes(sig));
}

// Transient = retryable. Excludes hook-side timeout and parse_failed by
// verdict tag (those are deterministic and retry can't help). Quota errors
// take the model-fallback path instead — they're not transient either.
function isTransientError(err) {
  if (err && typeof err === "object") {
    if (err.verdict === "timeout" || err.verdict === "parse_failed") return false;
  }
  if (isQuotaError(err)) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_SIGNALS.some((sig) => sig.test(msg));
}

function sleepMs(ms) {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

// Attach a verdict tag to an Error so the main() catch can classify the
// failure into the closed VERDICT_PREFIXES set without re-parsing the message.
function taggedError(message, verdict) {
  const err = new Error(message);
  err.verdict = verdict;
  return err;
}

function verdictFromError(err) {
  if (err && typeof err === "object" && typeof err.verdict === "string" && err.verdict in VERDICT_PREFIXES) {
    return err.verdict;
  }
  return "error";
}

// Pull `{"type":"error"}` event messages out of codex --json stdout. On a
// non-zero exit the real failure reason is usually HERE, while stderr holds
// only the "Reading prompt from stdin..." banner (#176).
function extractJsonlErrorEvents(stdout) {
  const messages = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed?.type === "error") {
      messages.push(typeof parsed.message === "string" ? parsed.message : JSON.stringify(parsed));
    }
  }
  return messages;
}

// Last non-empty stderr lines (≤3), capped at 500 chars. The informative
// part of codex stderr is the TAIL. Capped at 500 chars here; clampReason
// applies the UTF-8 byte clamp downstream before the reason is logged.
function stderrTail(stderr) {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return "";
  const tail = lines.slice(-3).join(" | ");
  return tail.length > 500 ? tail.slice(-500) : tail;
}

// Single codex invocation. The stdio + stdin-end pattern (and the SIGTERM →
// SIGKILL escalation, now tree-aware per ADR-084) mirrors
// `packages/shared/src/commandExecutor.ts`. Critically: stdin must be "pipe"
// (not "ignore") and must be ended explicitly, otherwise codex hangs on its
// stdin probe (issue #19 / first-hand observation: stdout stalls at
// "Reading additional input from stdin..." indefinitely).
function spawnCodex({ prompt, model, timeoutMs }) {
  return new Promise((resolveCall, rejectCall) => {
    const args = buildCodexArgs(model);
    const child = spawn("codex", args, {
      stdio: ["pipe", "pipe", "pipe"],
      // ADR-084: process-group leader on POSIX so terminateProcessTree can
      // kill codex + the Rust subprocess + any git-via-codex grandchildren.
      detached: !IS_WINDOWS,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminateProcessTree(child, "SIGTERM");
      setTimeout(() => {
        terminateProcessTree(child, "SIGKILL");
      }, 5000);
      rejectCall(
        taggedError(`codex exec timed out after ${Math.round(timeoutMs / 1000)}s`, "timeout"),
      );
    }, timeoutMs);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectCall(taggedError(`failed to spawn codex: ${err.message}`, "spawn_failed"));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        try {
          resolveCall(parseCodexJsonl(stdout));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          rejectCall(taggedError(msg, "parse_failed"));
        }
      } else {
        // Prefer the JSONL error event (the real reason) over the stderr
        // tail (often just the stdin banner) — #176.
        const errorEvents = extractJsonlErrorEvents(stdout);
        const reason =
          errorEvents.length > 0
            ? errorEvents[errorEvents.length - 1]
            : stderrTail(stderr) || `codex exit ${code}`;
        rejectCall(taggedError(reason, "error"));
      }
    });
  });
}

// Spawn codex with one retry on transient failures. The retry is jittered
// (1000 + Math.random()*1500 ms) to avoid synchronized retries across
// multiple concurrent hook invocations. Quota errors fall through unretried
// (handled by the outer fallback layer); hook-side timeouts and parse_failed
// errors are explicitly excluded by verdictFromError tag.
async function spawnCodexWithRetry({ prompt, model, timeoutMs, markerDir }) {
  try {
    return await spawnCodex({ prompt, model, timeoutMs });
  } catch (err) {
    if (!isTransientError(err)) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    const delayMs = 1000 + Math.random() * 1500;
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      verdict: "retried",
      reason,
      model,
      delayMs: Math.round(delayMs),
    });
    await sleepMs(delayMs);
    return await spawnCodex({ prompt, model, timeoutMs });
  }
}

// M4: cached plugin clientInfo for broker handshake. Built once per
// process (per ADR-095, plugin version detection used to silently always
// return "unknown" before the ESM fix).
let _cachedBrokerClientInfo = null;
function brokerClientInfo() {
  if (_cachedBrokerClientInfo) return _cachedBrokerClientInfo;
  let v = "unknown";
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8"));
    v = manifest?.version || "unknown";
  } catch {
    // best-effort
  }
  _cachedBrokerClientInfo = { name: "codex-pair", title: `codex-pair plugin v${v}`, version: v };
  return _cachedBrokerClientInfo;
}

// M4: broker-path wrapper. Opens an RPC connection to the running
// `codex app-server`, calls submitReview, closes the connection.
// Connect/initialize failures get tagged with `err.brokerFailure = true`
// so runCodexWithFallback falls back to spawnCodex silently (ADR-077).
// Wall-clock budget is the same as spawnCodex's `timeoutMs`.
async function runWithBroker({ prompt, timeoutMs, model, markerDir }) {
  const state = readBrokerState(markerDir);
  if (!state) {
    const err = new Error("runWithBroker: no broker descriptor");
    err.brokerFailure = true;
    err.brokerPhase = "connect";
    throw err;
  }
  let connection = null;
  let rpc = null;
  try {
    // Tight handshake budget — broker should be already running; if it
    // takes more than 2s to handshake, treat as broken and fall back
    // rather than blocking the hook (M4 brainstorm Risk #3).
    const init = await initializeBroker(state.transportUrl, brokerClientInfo(), {
      handshakeTimeoutMs: 2000,
      initializeTimeoutMs: 2000,
    });
    connection = init.connection;
    rpc = init.rpc;
  } catch (err) {
    if (err && typeof err === "object") {
      err.brokerFailure = true;
      err.brokerPhase = err.brokerPhase || "connect";
    }
    throw err;
  }
  try {
    return await submitReview({
      connection,
      rpc,
      cwd: markerDir,
      // baseInstructions is folded into `prompt` by buildReviewPrompt
      // already; passing empty string keeps the codex API happy.
      baseInstructions: "",
      prompt,
      model,
      timeoutMs,
    });
  } finally {
    if (connection) {
      try {
        connection.close(1000, "review done");
      } catch {
        // best-effort
      }
    }
  }
}

async function runCodexWithFallback({ prompt, timeoutMs, model, fallbackModel, markerDir }) {
  // M4: try the broker first if enabled. On err.brokerFailure (transport,
  // handshake, parse-layer failure) fall through to per-edit spawnCodex
  // silently per ADR-077. On other errors (verdict:"error" from a real
  // codex result, verdict:"timeout") propagate as-is — retrying via
  // spawnCodex would double the spend on cases where the model
  // legitimately couldn't produce a verdict.
  if (isBrokerEnabled(markerDir)) {
    try {
      return {
        response: await runWithBroker({ prompt, model, timeoutMs, markerDir }),
        fellBack: false,
        viaBroker: true,
      };
    } catch (err) {
      if (!err?.brokerFailure) throw err;
      // brokerFailure → silent fall-through to spawnCodex path below.
      // Append a log entry so dogfooders can audit broker-mode regressions.
      try {
        await appendLog(markerDir, {
          timestamp: new Date().toISOString(),
          verdict: "broker_fallback",
          reason: `${err.brokerPhase || "unknown"}: ${err.message ?? String(err)}`,
        });
      } catch {
        // best-effort; logging failure must never break the hook
      }
    }
  }
  try {
    return {
      response: await spawnCodexWithRetry({ prompt, model, timeoutMs, markerDir }),
      fellBack: false,
    };
  } catch (err) {
    if (isQuotaError(err) && model !== fallbackModel) {
      const response = await spawnCodexWithRetry({
        prompt,
        model: fallbackModel,
        timeoutMs,
        markerDir,
      });
      return { response, fellBack: true };
    }
    throw err;
  }
}

// Spawn the detached edit-debounce worker (design 2026-06-03). Mirrors the
// detached+unref pattern from spawnBroker. Returns true on success; the caller
// falls back to a synchronous review when this returns false.
function spawnDebounceWorker({ markerDir, filePath, toolName, generation, settleMs, maxMs, sessionId }) {
  try {
    const worker = spawn(process.execPath, [join(SCRIPT_DIR, "codex-pair-debounce-worker.mjs")], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        CP_MARKER_DIR: markerDir,
        CP_FILE: filePath,
        CP_TOOL: toolName,
        CP_GENERATION: String(generation),
        CP_SETTLE_MS: String(settleMs),
        CP_MAX_MS: String(maxMs),
        CP_SESSION_ID: sessionId ?? "",
      },
    });
    worker.on("error", () => {});
    worker.unref();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (process.env.CODEX_PAIR_DISABLED === "1") process.exit(0);

  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const toolName = payload?.tool_name;
  if (!WATCHED_TOOLS.has(toolName)) process.exit(0);

  const filePath = payload?.tool_input?.file_path;
  if (!filePath || typeof filePath !== "string") process.exit(0);

  // Marker resolution starts from the edited file's directory, not cwd.
  // In multi-repo workflows where Claude Code's cwd is one repo but the edit
  // happens in another (e.g. cross-repo navigation, monorepo with linked
  // siblings), cwd-anchored resolution writes logs to the wrong repo. The
  // file_path is always absolute per Claude Code's tool_input contract, so
  // its dirname is a reliable anchor that matches the edit's actual project.
  // See issue #65. Also hoisted to module scope so the catch handler can
  // log unhandled exceptions to the correct repo without re-parsing stdin.
  markerAnchor = dirname(filePath);
  const markerDir = await findMarkerUp(markerAnchor);
  if (!markerDir) process.exit(0);

  if (isPaused(markerDir)) {
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      verdict: "skipped",
      reason: "paused via /codex-pair-pause (rm .codex-pair/state/paused to resume)",
    });
    process.exit(0);
  }

  const lower = filePath.toLowerCase();
  if (SKIP_PATTERNS.some((p) => lower.includes(p))) process.exit(0);

  // ADR-096: .codex-pair/include — inclusion-list scoping. When present + non-
  // empty, ONLY files matching at least one rule are reviewed. Lets users
  // scope codex-pair to high-stakes paths (src/billing/**, src/auth/**) and
  // avoid paying $0.05/edit on routine refactor code. Applied BEFORE the
  // ignore-list — include narrows; ignore then excludes from the narrowed set.
  //
  // ADR-097 multi-review hotfix on ADR-096 (Codex finding #4): if include
  // has ONLY negation rules (e.g., `!*.test.ts`), the user's intent is
  // "review everything EXCEPT these patterns" — symmetric with ignore-list
  // semantics. Without this fix, negation-only include silently skipped
  // every file (no positive rule = no match for anything = always skip).
  // The fix: strip the `negate` flag from those rules and append them to
  // the ignore-list, then proceed with no inclusion gate.
  const includeRules = readIncludeFile(markerDir);
  const positiveInclude = includeRules.filter((r) => !r.negate);
  const includeNegationsAsIgnore = [];
  if (positiveInclude.length > 0) {
    // Standard inclusion gate with full rule set (positive + negation)
    const includeMatch = matchesIgnoreRule(filePath, markerDir, includeRules);
    if (!includeMatch) {
      await appendLog(markerDir, {
        timestamp: new Date().toISOString(),
        tool: toolName,
        file: filePath,
        verdict: "skipped",
        reason: "file not in .codex-pair/include scope",
      });
      process.exit(0);
    }
  } else if (includeRules.length > 0) {
    // Negation-only include — transform each `!pattern` into a positive
    // ignore rule. Log once per fire so users see the semantic mapping.
    for (const r of includeRules) {
      includeNegationsAsIgnore.push({ negate: false, pattern: r.pattern, raw: r.raw });
    }
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      level: "info",
      reason:
        ".codex-pair/include has only negation rules — interpreting as 'review everything except these patterns' (treating as ignore-list entries). Add a positive rule like '**' to use include as a strict allow-list.",
    });
  }

  // .codex-pair/ignore — granular per-project opt-out via gitignore-style
  // globs. Match → silent log skip with the matching pattern, NO
  // systemMessage (preserves silent-gating UX for opted-out files).
  const ignoreRulesRaw = readIgnoreFile(markerDir);
  const ignoreRules = [...ignoreRulesRaw, ...includeNegationsAsIgnore];
  const ignoreMatch = matchesIgnoreRule(filePath, markerDir, ignoreRules);
  if (ignoreMatch) {
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      verdict: "skipped",
      reason: `matched .codex-pair/ignore: ${ignoreMatch.raw}`,
    });
    process.exit(0);
  }

  // Read + parse the marker file FIRST so config (model/timeout/cap/threshold)
  // can take effect on the file-size check below. Malformed frontmatter is a
  // silent fallback to defaults plus a "warning"-level log entry.
  let projectContext = "";
  let frontmatter = {};
  let frontmatterMalformed = false;
  try {
    const markerContent = await readFile(contextPath(markerDir), "utf8");
    const parsed = parseFrontmatter(markerContent);
    projectContext = parsed.body;
    frontmatter = parsed.frontmatter;
    frontmatterMalformed = parsed.malformed;
  } catch {
    // marker unreadable — proceed with empty context and defaults
  }
  if (frontmatterMalformed) {
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      level: "warning",
      reason:
        "malformed frontmatter in .codex-pair/context.md — opener `---` with no matching closer; falling back to defaults",
    });
  }
  const config = resolveConfig(frontmatter);

  // Edit-debounce (design 2026-06-03, #96). When enabled, this edit is recorded
  // and a detached worker reviews the SETTLED file after the window — the hook
  // does NOT review inline. force-sync (set by the worker's re-invocation)
  // collapses the window to 0 so the synchronous path below runs verbatim.
  const effectiveDebounceMs = process.env.CODEX_PAIR_FORCE_SYNC === "1" ? 0 : config.debounceMs;
  if (effectiveDebounceMs > 0) {
    const record = bumpEditRecord(markerDir, filePath, {
      sessionId: payload?.session_id,
      now: Date.now(),
    });
    if (Math.random() < 0.05) sweepStaleDebounce(markerDir, config.debounceMaxMs);
    const spawned = spawnDebounceWorker({
      markerDir,
      filePath,
      toolName,
      generation: record.generation,
      settleMs: effectiveDebounceMs,
      maxMs: config.debounceMaxMs,
      sessionId: payload?.session_id,
    });
    if (spawned) {
      // Surface any verdict a prior worker queued (the worker has no stdout to
      // Claude). Drained ONLY on the successful-dispatch path so it cannot pair
      // with the synchronous review's emit below into a double systemMessage;
      // on spawn failure the pending verdict stays queued for the next hook.
      const pendingMessages = drainPending(markerDir);
      if (pendingMessages.length > 0) {
        await emitSystemMessage(joinPendingForSurface(pendingMessages));
      }
      process.exit(0);
    }
    // Worker spawn failed → fall through to a synchronous review (safety net),
    // leaving any pending verdict queued to drain on a later hook.
  }

  let fileContent;
  try {
    fileContent = await readFile(filePath, "utf8");
  } catch (err) {
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      verdict: "skipped",
      reason: `unreadable: ${err.message}`,
    });
    await emitSystemMessage(
      `codex-pair ${VERDICT_PREFIXES.skipped}: ${filePath} — unreadable (${err.message})`,
    );
    process.exit(0);
  }

  const fileBytes = Buffer.byteLength(fileContent, "utf8");
  // Adaptive context: under-cap → full file (unchanged). Over-cap → build a
  // partial view (diff or head+tail) and pass a partial-view warning to codex
  // instead of silently skipping. Replaces ADR-077's original over-cap skip.
  let promptContent = fileContent;
  let partialView = false;
  let contextStrategy = "full";
  if (fileBytes > config.maxFileBytes) {
    const adaptive = await buildAdaptiveContext({
      filePath,
      fileContent,
      markerDir,
      maxFileBytes: config.maxFileBytes,
    });
    promptContent = adaptive.content;
    partialView = true;
    contextStrategy = adaptive.strategy;
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      level: "info",
      reason: `over-cap (${fileBytes} bytes > ${config.maxFileBytes}); using adaptive context strategy "${contextStrategy}"`,
    });
  }

  const prompt = buildPrompt({
    filePath,
    fileContent: promptContent,
    toolName,
    projectContext,
    partialView,
  });

  const startedAt = Date.now();

  // Content-hash cache check (item #8). Same inputs → same review → skip the
  // codex spawn entirely on hit. Cache miss falls through to normal flow.
  const cacheKey = computeCacheKey({
    model: config.model,
    prompt,
    fileContent: promptContent,
    surfaceThreshold: config.surfaceThreshold,
  });
  const cached = await getCachedConcerns(markerDir, cacheKey);
  if (cached) {
    const cachedDurationMs = Date.now() - startedAt;
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      verdict: "cached",
      counts: {
        high: cached.high.length,
        med: cached.med.length,
        low: cached.low.length,
      },
      durationMs: cachedDurationMs,
      originalDurationMs: cached.durationMs,
      concerns: {
        high: cached.high.map((c) => c.slice(0, 800)),
        med: cached.med.map((c) => c.slice(0, 800)),
        low: cached.low.map((c) => c.slice(0, 800)),
      },
    });
    // ADR-097 (ADR-096 multi-review hotfix): cache-hit path is READ-ONLY
    // against repetitions state. Mutating on cache hits caused the
    // "rapid undo/redo false-fire" Gemini flagged — same content hash =
    // cache hit, so 3 trivial saves of unchanged content would cross
    // the BLOCKING threshold without the user ever seeing the verdict
    // a second time. The cache TTL (10 min) already bounds how often
    // live reviews fire; live reviews remain the only path that
    // increments. The cache-hit path now reads the current shard and
    // surfaces the banner ONLY if a prior live review crossed threshold.
    const cachedHashes = [
      ...cached.high.map(hashConcernBody),
      ...cached.med.map(hashConcernBody),
      ...cached.low.map(hashConcernBody),
    ];
    let cachedRepeatedIgnoredCount = 0;
    try {
      const blocking = getBlockingFromShard(markerDir, filePath, cachedHashes);
      cachedRepeatedIgnoredCount = blocking.length;
    } catch {
      // best-effort
    }
    await emitSystemMessage(
      buildVerdictMessage({
        filePath,
        concerns: cached,
        fellBack: false,
        durationMs: cachedDurationMs,
        surfaceThreshold: config.surfaceThreshold,
        cached: true,
        repeatedIgnoredCount: cachedRepeatedIgnoredCount,
        logPath: logPath(markerDir),
      }),
    );
    process.exit(0);
  }

  // ADR-087: inflight lock per file path. Cache miss reached → we're about
  // to spawn codex. If another hook is mid-spawn for the same file, coalesce:
  // log skipped and exit. TTL = max(codex timeout, 10 min) + 60s buffer so
  // stale-recovery never steals still-valid locks.
  const inflightTtlMs = Math.max(config.timeoutMs, INFLIGHT_TTL_MIN_MS) + 60_000;
  const lockResult = tryAcquireInflightLock(markerDir, filePath, inflightTtlMs);
  if (!lockResult.acquired) {
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      verdict: "skipped",
      reason: `coalesced — another review is in-flight for this file (${lockResult.reason})`,
    });
    process.exit(0);
  }
  const acquiredLockPath = lockResult.lockPath;
  process.on("exit", () => releaseInflightLock(acquiredLockPath));

  let response;
  let fellBack = false;
  try {
    // M4 multi-review hotfix: dispatch unified through runCodexWithFallback
    // for BOTH broker and spawn modes. Previous duplicate inline branch
    // bypassed runWithBroker's brokerFailure-fallback semantics + missed
    // initialize handshake + missed quota fallback. Both /multi-review
    // reviewers (Codex 98% + Claude 98%) caught this independently —
    // a duplicate dispatch path I auto-completed without realizing.
    const result = await runCodexWithFallback({
      prompt,
      timeoutMs: config.timeoutMs,
      model: config.model,
      fallbackModel: config.fallbackModel,
      markerDir,
    });
    response = result.response;
    fellBack = result.fellBack;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const verdict = verdictFromError(err);
    const prefix = VERDICT_PREFIXES[verdict] ?? VERDICT_PREFIXES.error;
    const durationMs = Date.now() - startedAt;
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      verdict,
      reason,
      durationMs,
    });
    await emitSystemMessage(
      `codex-pair ${prefix}: ${filePath} — review failed: ${reason} (${formatDuration(durationMs)})`,
    );
    process.exit(0);
  }

  const concerns = parseConcerns(response);
  const total = concerns.high.length + concerns.med.length + concerns.low.length;
  const durationMs = Date.now() - startedAt;

  // Cache the parsed concerns for future identical-input calls. Failures here
  // are silent — a write failure shouldn't break the user-visible review.
  await setCachedConcerns(markerDir, cacheKey, {
    high: concerns.high,
    med: concerns.med,
    low: concerns.low,
    durationMs,
  });

  await appendLog(markerDir, {
    timestamp: new Date().toISOString(),
    tool: toolName,
    file: filePath,
    verdict: total === 0 ? "none" : "concerns",
    fellBack,
    counts: {
      high: concerns.high.length,
      med: concerns.med.length,
      low: concerns.low.length,
    },
    durationMs,
    concerns: {
      high: concerns.high.map((c) => c.slice(0, 800)),
      med: concerns.med.map((c) => c.slice(0, 800)),
      low: concerns.low.map((c) => c.slice(0, 800)),
    },
  });

  // ADR-096: repetition tracker. Hash each concern body across all severities;
  // updateRepetitions increments counts for concerns flagged again on the
  // same file and drops concerns the user has clearly fixed. When the
  // count crosses REPETITION_BLOCKING_THRESHOLD, the systemMessage gets a
  // loud BLOCKING banner so the consumer can't silently keep ignoring it.
  const repetitionHashes = [
    ...concerns.high.map(hashConcernBody),
    ...concerns.med.map(hashConcernBody),
    ...concerns.low.map(hashConcernBody),
  ];
  let repeatedIgnoredCount = 0;
  try {
    const blocking = await updateRepetitions(markerDir, filePath, repetitionHashes);
    repeatedIgnoredCount = blocking.length;
  } catch {
    // best-effort — repetitions are advisory; failure must not break the hook
  }

  await emitSystemMessage(
    buildVerdictMessage({
      filePath,
      concerns,
      fellBack,
      durationMs,
      surfaceThreshold: config.surfaceThreshold,
      repeatedIgnoredCount,
      logPath: logPath(markerDir),
    }),
  );

  process.exit(0);
}

main().catch(async (err) => {
  try {
    // Prefer the hoisted markerAnchor (set from dirname(filePath) once the
    // payload was validated) so unhandled-exception logs land in the edited
    // file's repo, not cwd's. Falls back to cwd only when main() threw
    // before payload parsing — the unavoidable case where filePath is
    // unknown. Multi-review on PR #76 flagged the prior cwd-only path as a
    // residual cross-repo gap; this hoist closes it.
    const anchor = markerAnchor ?? process.cwd();
    const markerDir = await findMarkerUp(anchor);
    if (markerDir) {
      await appendLog(markerDir, {
        timestamp: new Date().toISOString(),
        verdict: "error",
        reason: `unhandled: ${err?.message ?? String(err)}`,
      });
    }
  } catch {
    // ignore — nothing more we can do
  }
  process.exit(0);
});
