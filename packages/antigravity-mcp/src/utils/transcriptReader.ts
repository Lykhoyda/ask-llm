import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Logger } from "@ask-llm/shared";

// One millisecond covers Date.now/file-mtime rounding without admitting an older write.
const TIMESTAMP_TOLERANCE_MS = 1;

export function defaultBaseDir(): string {
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

interface TranscriptFile {
  contents: string;
  path: string;
  mtimeMs: number;
  size: number;
}

interface TranscriptFingerprint {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface TranscriptStateSnapshot {
  baseDir: string;
  transcripts: Readonly<Record<string, TranscriptFingerprint | null>>;
}

export interface TranscriptResult {
  response: string;
  path: string;
  conversationId: string;
}

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
  }
  return null;
}

function listConversationIds(baseDir: string): string[] {
  try {
    return readdirSync(join(baseDir, "brain")).filter((id) => {
      try {
        return statSync(join(baseDir, "brain", id)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function readFileOrNull(path: string): TranscriptFile | null {
  try {
    const contents = readFileSync(path, "utf8");
    const stat = statSync(path);
    return { contents, path, mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

function fingerprintFileOrNull(path: string): TranscriptFingerprint | null {
  try {
    const fileStat = statSync(path);
    return fileStat.isFile() ? { path, mtimeMs: fileStat.mtimeMs, size: fileStat.size } : null;
  } catch {
    return null;
  }
}

function readAuthoritativeTranscript(baseDir: string, conversationId: string): TranscriptFile | null {
  const logsDir = join(baseDir, "brain", conversationId, ".system_generated", "logs");
  return readFileOrNull(join(logsDir, "transcript_full.jsonl")) ?? readFileOrNull(join(logsDir, "transcript.jsonl"));
}

function fingerprintAuthoritativeTranscript(baseDir: string, conversationId: string): TranscriptFingerprint | null {
  const logsDir = join(baseDir, "brain", conversationId, ".system_generated", "logs");
  return (
    fingerprintFileOrNull(join(logsDir, "transcript_full.jsonl")) ??
    fingerprintFileOrNull(join(logsDir, "transcript.jsonl"))
  );
}

export function snapshotTranscriptState(baseDir: string = defaultBaseDir()): TranscriptStateSnapshot {
  const transcripts: Record<string, TranscriptFingerprint | null> = {};
  for (const id of listConversationIds(baseDir)) {
    transcripts[id] = fingerprintAuthoritativeTranscript(baseDir, id);
  }
  return { baseDir, transcripts };
}

function readCachedConversationId(baseDir: string): string | null {
  try {
    return pickMostRecentId(JSON.parse(readFileSync(join(baseDir, "cache", "last_conversations.json"), "utf8")));
  } catch {
    return null;
  }
}

function changedSinceSnapshot(
  conversationId: string,
  transcript: TranscriptFile,
  snapshot: TranscriptStateSnapshot,
): boolean {
  const before = snapshot.transcripts[conversationId];
  if (before === undefined || before === null) return true;
  return before.path !== transcript.path || before.mtimeMs !== transcript.mtimeMs || before.size !== transcript.size;
}

function readCorrelatedTranscript(
  conversationId: string,
  sinceMs: number,
  snapshot: TranscriptStateSnapshot,
): TranscriptFile | null {
  const transcript = readAuthoritativeTranscript(snapshot.baseDir, conversationId);
  if (!transcript) return null;
  if (transcript.mtimeMs + TIMESTAMP_TOLERANCE_MS < sinceMs) return null;
  return changedSinceSnapshot(conversationId, transcript, snapshot) ? transcript : null;
}

function resolveTranscript(
  sinceMs: number,
  snapshot: TranscriptStateSnapshot,
): { id: string; file: TranscriptFile } | null {
  const cachedId = readCachedConversationId(snapshot.baseDir);
  if (cachedId) {
    const cached = readCorrelatedTranscript(cachedId, sinceMs, snapshot);
    return cached ? { id: cachedId, file: cached } : null;
  }

  const candidates = listConversationIds(snapshot.baseDir).flatMap((id) => {
    const file = readCorrelatedTranscript(id, sinceMs, snapshot);
    return file ? [{ id, file }] : [];
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function extractText(entry: TranscriptEntry): string | null {
  const text = entry.text ?? entry.content ?? entry.message;
  return typeof text === "string" && text.length > 0 ? text : null;
}

export function readLatestTranscript(sinceMs: number, snapshot: TranscriptStateSnapshot): TranscriptResult | null {
  const resolved = resolveTranscript(sinceMs, snapshot);
  if (!resolved) {
    Logger.debug("antigravity: no transcript could be correlated to this invocation");
    return null;
  }

  let answer: string | null = null;
  for (const line of resolved.file.contents.split("\n")) {
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
      if (text) answer = text;
    }
  }
  if (!answer) {
    Logger.debug("antigravity: transcript present but no MODEL/DONE/PLANNER_RESPONSE entry found (schema change?)");
    return null;
  }
  return { response: answer, path: resolved.file.path, conversationId: resolved.id };
}

export function readLatestResponse(sinceMs: number, snapshot: TranscriptStateSnapshot): string | null {
  return readLatestTranscript(sinceMs, snapshot)?.response ?? null;
}
