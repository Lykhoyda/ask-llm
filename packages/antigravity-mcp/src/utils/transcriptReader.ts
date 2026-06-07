import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Logger } from "@ask-llm/shared";

export function defaultBaseDir(): string {
  // ASK_ANTIGRAVITY_BASE_DIR overrides the assumed location of agy's data dir —
  // the path most likely to need correcting against a real agy install (spec §10).
  return process.env.ASK_ANTIGRAVITY_BASE_DIR ?? join(homedir(), ".gemini", "antigravity-cli");
}

interface TranscriptEntry {
  source?: string;
  status?: string;
  type?: string;
  text?: string;
  content?: string;
  message?: string;
}

// last_conversations.json shape is undocumented. Tolerate: array of ids, array
// of {id}, or an object (keyed by id, or with lastId / conversations). Unknown → null.
function pickMostRecentId(parsed: unknown): string | null {
  if (Array.isArray(parsed)) {
    for (let i = parsed.length - 1; i >= 0; i--) {
      const el = parsed[i];
      if (typeof el === "string") return el;
      if (el && typeof el === "object" && typeof (el as { id?: unknown }).id === "string") {
        return (el as { id: string }).id;
      }
    }
    return null;
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.lastId === "string") return obj.lastId;
    if (Array.isArray(obj.conversations)) return pickMostRecentId(obj.conversations);
    // A bare object keyed by conversation id gives no reliable recency signal:
    // integer-like keys enumerate in ascending numeric order and string keys in
    // insertion order — neither tracks creation time — so return null and let the
    // caller fall through to the mtime-based brain-dir scan instead of guessing.
  }
  return null;
}

// Resolve the conversation id of the run we just triggered: prefer agy's
// cache/last_conversations.json; else the newest brain/<id> modified at/after sinceMs.
function resolveConversationId(baseDir: string, sinceMs: number): string | null {
  try {
    const raw = readFileSync(join(baseDir, "cache", "last_conversations.json"), "utf8");
    const id = pickMostRecentId(JSON.parse(raw));
    if (id) return id;
  } catch {
    // fall through to brain-dir scan
  }
  try {
    const brainDir = join(baseDir, "brain");
    let newest: { id: string; mtimeMs: number } | null = null;
    for (const id of readdirSync(brainDir)) {
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(join(brainDir, id));
      } catch {
        continue;
      }
      // skip stray non-directory entries (e.g. .DS_Store, lock files) so they
      // can't become the "newest" id and break the transcript path (#153 dogfood).
      if (!stat.isDirectory()) continue;
      const mtimeMs = stat.mtimeMs;
      // include if mtimeMs >= sinceMs - 1 (1ms tolerance for coarse FS timestamps)
      if (mtimeMs + 1 < sinceMs) continue;
      if (!newest || mtimeMs > newest.mtimeMs) newest = { id, mtimeMs };
    }
    return newest?.id ?? null;
  } catch {
    return null;
  }
}

function extractText(entry: TranscriptEntry): string | null {
  const text = entry.text ?? entry.content ?? entry.message;
  return typeof text === "string" && text.length > 0 ? text : null;
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// Read agy's transcript for the resolved conversation and return the last
// completed model response, or null if absent/unreadable. Never throws.
// Schema validated against agy 1.0.6 (#153 dogfood): the answer is the last entry
// with source=MODEL, status=DONE, type=PLANNER_RESPONSE, and its text in `content`.
export function readLatestResponse(sinceMs: number, baseDir: string = defaultBaseDir()): string | null {
  const convId = resolveConversationId(baseDir, sinceMs);
  if (!convId) {
    Logger.debug("antigravity: could not resolve a conversation id from cache or brain dir");
    return null;
  }
  const logsDir = join(baseDir, "brain", convId, ".system_generated", "logs");
  // agy writes a token-truncated transcript.jsonl plus a complete
  // transcript_full.jsonl; prefer the full one so long responses aren't clipped
  // (verified against agy 1.0.6 — #153 dogfood), falling back to transcript.jsonl.
  // Note: readFileOrNull returns file *contents*, so once transcript_full.jsonl
  // exists it wins even if it yields no model entry (e.g. agy crashed mid-write) —
  // we return null rather than fall back to the truncated copy. Intentional:
  // full > truncated; a full file with no model entry means the run didn't finish (#154).
  const raw =
    readFileOrNull(join(logsDir, "transcript_full.jsonl")) ?? readFileOrNull(join(logsDir, "transcript.jsonl"));
  if (raw === null) {
    Logger.debug(`antigravity: no transcript (full or truncated) under ${logsDir}`);
    return null;
  }
  let answer: string | null = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(trimmed) as TranscriptEntry;
    } catch {
      continue;
    }
    if (entry.source === "MODEL" && entry.status === "DONE" && entry.type === "PLANNER_RESPONSE") {
      const text = extractText(entry);
      if (text) answer = text; // keep the LAST matching entry
    }
  }
  if (!answer) {
    Logger.debug("antigravity: transcript present but no MODEL/DONE/PLANNER_RESPONSE entry found (schema change?)");
  }
  return answer;
}
