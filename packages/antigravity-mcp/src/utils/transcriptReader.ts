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
    // A bare object keyed by conversation id gives no reliable recency order
    // (V8 sorts integer-like keys numerically), so return null and let the caller
    // fall through to the mtime-based brain-dir scan instead of guessing wrong.
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
      let mtimeMs: number;
      try {
        mtimeMs = statSync(join(brainDir, id)).mtimeMs;
      } catch {
        continue;
      }
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

// Read agy's transcript for the resolved conversation and return the last
// completed model response, or null if absent/unreadable. Never throws.
// NOTE: confirm source/status/type/text field names against a real agy transcript
// (spec §10.2). The chosen values match the community MCP bridge precedent.
export function readLatestResponse(sinceMs: number, baseDir: string = defaultBaseDir()): string | null {
  const convId = resolveConversationId(baseDir, sinceMs);
  if (!convId) {
    Logger.debug("antigravity: could not resolve a conversation id from cache or brain dir");
    return null;
  }
  const transcriptPath = join(baseDir, "brain", convId, ".system_generated", "logs", "transcript.jsonl");
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    Logger.debug(`antigravity: transcript not found at ${transcriptPath}`);
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
