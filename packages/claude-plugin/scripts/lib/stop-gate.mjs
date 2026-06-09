// scripts/lib/stop-gate.mjs
// Pure, I/O-free gate logic for the codex-pair Stop hook (#142, ADR-118).
// No workspace imports — the hook ships without node_modules.

import { isAbsolute, join, relative } from "node:path";
import { hashConcernBody } from "./state.mjs";

// Parse `git status --porcelain` (v1) into a Set of ABSOLUTE paths that are
// modified or untracked relative to HEAD. repoRoot = `git rev-parse
// --show-toplevel`. Rename lines ("R  old -> new") contribute the NEW path
// (that's the file present on disk). The first 3 chars are the XY status +
// space; the path starts at index 3.
export function parseGitPorcelain(stdout, repoRoot) {
  const dirty = new Set();
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    let path = line.slice(3);
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    path = path.replace(/^"|"$/g, ""); // git quotes paths with special chars
    dirty.add(isAbsolute(path) ? path : join(repoRoot, path));
  }
  return dirty;
}

const INDETERMINATE = new Set(["skipped", "error", "retried", "broker_fallback"]);

// Reconcile latest-per-file entries against present reality, returning the
// unacked HIGH findings that should block turn-end.
//   entries   Map<file, latestEntry>      (from selectLatestEntries)
//   acks      { [hash]: {reason, ts} }     (from readAcks)
//   existsFn  (absFile) => boolean         (injected fs.existsSync)
//   gitDirty  Set<absPath> | null          (null = no git filter)
//   markerDir project root for relPath ack identity
export function collectBlockingHighs({ entries, acks, existsFn, gitDirty, markerDir }) {
  const blocking = [];
  for (const [file, entry] of entries) {
    if (!existsFn(file)) continue; // [A] deleted/renamed
    if (INDETERMINATE.has(entry.verdict)) continue; // [C] indeterminate latest → fail-open
    if (gitDirty && !gitDirty.has(file)) continue; // [B] clean vs HEAD
    const highs = entry.concerns?.high ?? [];
    for (const text of highs) {
      const hash = hashConcernBody(`${relative(markerDir, file)}:${text}`); // [E] file-scoped
      if (!acks[hash]) blocking.push({ file, text, hash });
    }
  }
  return blocking;
}

// Parse log.jsonl text → Map<file, latestEntry>. Last write per file wins
// (the log is append-only; the final entry is the file's latest review).
export function selectLatestEntries(logText) {
  const latest = new Map();
  for (const line of logText.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let entry;
    try {
      entry = JSON.parse(t);
    } catch {
      continue;
    }
    if (entry && typeof entry.file === "string") latest.set(entry.file, entry);
  }
  return latest;
}
