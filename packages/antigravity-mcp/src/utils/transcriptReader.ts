import { createHash } from "node:crypto";
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
  completedResponseHashes: readonly string[];
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
    const before = statSync(path);
    const contents = readFileSync(path, "utf8");
    const after = statSync(path);
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) return null;
    return { contents, path, mtimeMs: after.mtimeMs, size: after.size };
  } catch {
    return null;
  }
}

function extractText(entry: TranscriptEntry): string | null {
  const text = entry.text ?? entry.content ?? entry.message;
  return typeof text === "string" && text.length > 0 ? text : null;
}

function completedResponses(contents: string): Array<{ hash: string; text: string }> {
  const responses: Array<{ hash: string; text: string }> = [];
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(trimmed) as TranscriptEntry;
    } catch {
      continue;
    }
    if (entry.source !== "MODEL" || entry.status !== "DONE" || entry.type !== "PLANNER_RESPONSE") continue;
    const text = extractText(entry);
    if (text) responses.push({ hash: createHash("sha256").update(text).digest("hex"), text });
  }
  return responses;
}

function readAuthoritativeTranscript(baseDir: string, conversationId: string): TranscriptFile | null {
  const logsDir = join(baseDir, "brain", conversationId, ".system_generated", "logs");
  return readFileOrNull(join(logsDir, "transcript_full.jsonl")) ?? readFileOrNull(join(logsDir, "transcript.jsonl"));
}

function fingerprintAuthoritativeTranscript(baseDir: string, conversationId: string): TranscriptFingerprint | null {
  const transcript = readAuthoritativeTranscript(baseDir, conversationId);
  if (!transcript) return null;
  return {
    path: transcript.path,
    mtimeMs: transcript.mtimeMs,
    size: transcript.size,
    completedResponseHashes: completedResponses(transcript.contents).map(({ hash }) => hash),
  };
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

function latestNewCompletedResponse(
  transcript: TranscriptFile,
  before: TranscriptFingerprint | null | undefined,
): string | null {
  const previousCounts = new Map<string, number>();
  for (const hash of before?.completedResponseHashes ?? []) {
    previousCounts.set(hash, (previousCounts.get(hash) ?? 0) + 1);
  }

  const currentCounts = new Map<string, number>();
  let latest: string | null = null;
  for (const response of completedResponses(transcript.contents)) {
    const occurrence = (currentCounts.get(response.hash) ?? 0) + 1;
    currentCounts.set(response.hash, occurrence);
    if (occurrence > (previousCounts.get(response.hash) ?? 0)) latest = response.text;
  }
  return latest;
}

function readCorrelatedTranscript(
  conversationId: string,
  sinceMs: number,
  snapshot: TranscriptStateSnapshot,
): { file: TranscriptFile; response: string } | null {
  const transcript = readAuthoritativeTranscript(snapshot.baseDir, conversationId);
  if (!transcript) return null;
  if (transcript.mtimeMs + TIMESTAMP_TOLERANCE_MS < sinceMs) return null;
  const response = latestNewCompletedResponse(transcript, snapshot.transcripts[conversationId]);
  return response ? { file: transcript, response } : null;
}

function resolveTranscript(
  sinceMs: number,
  snapshot: TranscriptStateSnapshot,
): { id: string; file: TranscriptFile; response: string } | null {
  const cachedId = readCachedConversationId(snapshot.baseDir);
  if (cachedId) {
    const cached = readCorrelatedTranscript(cachedId, sinceMs, snapshot);
    return cached ? { id: cachedId, ...cached } : null;
  }

  const candidates = listConversationIds(snapshot.baseDir).flatMap((id) => {
    const file = readCorrelatedTranscript(id, sinceMs, snapshot);
    return file ? [{ id, ...file }] : [];
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function readLatestTranscript(sinceMs: number, snapshot: TranscriptStateSnapshot): TranscriptResult | null {
  const resolved = resolveTranscript(sinceMs, snapshot);
  if (!resolved) {
    Logger.debug("antigravity: no transcript could be correlated to this invocation");
    return null;
  }

  return { response: resolved.response, path: resolved.file.path, conversationId: resolved.id };
}

export function readLatestResponse(sinceMs: number, snapshot: TranscriptStateSnapshot): string | null {
  return readLatestTranscript(sinceMs, snapshot)?.response ?? null;
}
