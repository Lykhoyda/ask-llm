import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Logger } from "./logger.js";

export type SessionRole = "user" | "assistant";

export interface SessionMessage {
  role: SessionRole;
  content: string;
}

export interface SessionRecord {
  id: string;
  provider: string;
  model: string;
  messages: SessionMessage[];
  createdAt: number;
  updatedAt: number;
}

const SESSION_DIR = path.join(os.tmpdir(), "ask-llm-sessions");
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SESSION_FILES = 200;
const MAX_MESSAGES_PER_SESSION = 40;

const SESSION_DIR_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;

function ensureSessionDir(): void {
  if (fs.existsSync(SESSION_DIR)) {
    try {
      const stat = fs.lstatSync(SESSION_DIR);
      if (!stat.isDirectory()) {
        throw new Error(`${SESSION_DIR} exists but is not a directory`);
      }
      if (stat.isSymbolicLink()) {
        throw new Error(`${SESSION_DIR} is a symbolic link — refusing to use`);
      }
      if ((stat.mode & 0o077) !== 0) {
        fs.chmodSync(SESSION_DIR, SESSION_DIR_MODE);
        Logger.debug(`Tightened session dir permissions to 0o700`);
      }
    } catch (err) {
      Logger.error(`Session dir validation failed: ${err}`);
      throw err;
    }
    return;
  }
  fs.mkdirSync(SESSION_DIR, { recursive: true, mode: SESSION_DIR_MODE });
}

function isSafeSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(sessionId);
}

function sessionPath(sessionId: string): string {
  return path.join(SESSION_DIR, `${sessionId}.json`);
}

export function createSessionId(): string {
  return randomUUID();
}

export function loadSession(sessionId: string): SessionRecord | null {
  if (!isSafeSessionId(sessionId)) {
    Logger.debug(`Rejecting unsafe session id: ${sessionId.slice(0, 16)}`);
    return null;
  }
  const file = sessionPath(sessionId);
  if (!fs.existsSync(file)) return null;

  try {
    const content = fs.readFileSync(file, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as SessionRecord).id !== "string" ||
      !Array.isArray((parsed as SessionRecord).messages) ||
      typeof (parsed as SessionRecord).updatedAt !== "number"
    ) {
      Logger.debug(`Session ${sessionId} has invalid shape, deleting`);
      try {
        fs.unlinkSync(file);
      } catch {}
      return null;
    }

    const record = parsed as SessionRecord;
    if (Date.now() - record.updatedAt > SESSION_TTL_MS) {
      Logger.debug(`Session ${sessionId} expired, deleting`);
      try {
        fs.unlinkSync(file);
      } catch {}
      return null;
    }

    for (const m of record.messages) {
      if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
        Logger.debug(`Session ${sessionId} has invalid message shape, deleting`);
        try {
          fs.unlinkSync(file);
        } catch {}
        return null;
      }
    }
    return record;
  } catch (error) {
    Logger.debug(`Session read error for ${sessionId}: ${error}`);
    try {
      fs.unlinkSync(file);
    } catch {}
    return null;
  }
}

export function saveSession(record: SessionRecord): boolean {
  if (!isSafeSessionId(record.id)) {
    throw new Error(`Refusing to save session with unsafe id: ${record.id.slice(0, 16)}`);
  }
  ensureSessionDir();
  cleanExpiredSessions();

  const trimmed: SessionRecord = {
    ...record,
    messages:
      record.messages.length > MAX_MESSAGES_PER_SESSION
        ? record.messages.slice(record.messages.length - MAX_MESSAGES_PER_SESSION)
        : record.messages,
    updatedAt: Date.now(),
  };

  const finalPath = sessionPath(record.id);
  const tmpPath = `${finalPath}.tmp.${process.pid}.${Date.now()}`;
  let persisted = false;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(trimmed), { mode: SESSION_FILE_MODE });
    fs.renameSync(tmpPath, finalPath);
    Logger.debug(`Saved session ${record.id} with ${trimmed.messages.length} messages`);
    persisted = true;
  } catch (error) {
    Logger.error(`Failed to save session ${record.id}: ${error}`);
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
  }
  enforceSessionLimit();
  return persisted;
}

export function appendAndSaveSession(
  sessionId: string | undefined,
  provider: string,
  model: string,
  userContent: string,
  assistantContent: string,
): { id: string; messages: SessionMessage[]; created: boolean; persisted: boolean } {
  let id = sessionId;
  let created = false;
  let existing: SessionRecord | null = null;

  if (id) {
    existing = loadSession(id);
    if (!existing) {
      created = true;
    }
  } else {
    id = createSessionId();
    created = true;
  }

  const now = Date.now();
  const messages: SessionMessage[] = existing ? [...existing.messages] : [];
  messages.push({ role: "user", content: userContent });
  messages.push({ role: "assistant", content: assistantContent });

  const record: SessionRecord = {
    id,
    provider,
    model,
    messages,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const persisted = saveSession(record);
  return { id, messages: record.messages, created, persisted };
}

export function buildPriorMessages(sessionId: string | undefined): SessionMessage[] {
  if (!sessionId) return [];
  const record = loadSession(sessionId);
  return record?.messages ?? [];
}

function cleanExpiredSessions(): void {
  try {
    ensureSessionDir();
    const files = fs.readdirSync(SESSION_DIR);
    const now = Date.now();
    let cleaned = 0;
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(SESSION_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > SESSION_TTL_MS) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch {}
    }
    if (cleaned > 0) Logger.debug(`Cleaned ${cleaned} expired session files`);
  } catch (error) {
    Logger.debug(`Session cleanup error: ${error}`);
  }
}

function enforceSessionLimit(): void {
  try {
    const files = fs
      .readdirSync(SESSION_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return { path: path.join(SESSION_DIR, f), mtime: fs.statSync(path.join(SESSION_DIR, f)).mtimeMs };
        } catch {
          // Vanished between readdir and stat (concurrent eviction/expiry) —
          // skip it rather than letting one ENOENT abort the whole sweep.
          return null;
        }
      })
      .filter((f): f is { path: string; mtime: number } => f !== null)
      .sort((a, b) => a.mtime - b.mtime);

    if (files.length > MAX_SESSION_FILES) {
      const toRemove = files.slice(0, files.length - MAX_SESSION_FILES);
      for (const file of toRemove) {
        try {
          fs.unlinkSync(file.path);
        } catch {}
      }
      Logger.debug(`Removed ${toRemove.length} oldest session files to enforce limit`);
    }
  } catch (error) {
    Logger.debug(`Session limit enforcement error: ${error}`);
  }
}

export const __test__ = {
  SESSION_DIR,
  SESSION_TTL_MS,
  MAX_SESSION_FILES,
  MAX_MESSAGES_PER_SESSION,
  SESSION_DIR_MODE,
  SESSION_FILE_MODE,
  isSafeSessionId,
  enforceSessionLimit,
};
