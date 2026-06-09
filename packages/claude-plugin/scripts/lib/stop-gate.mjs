// scripts/lib/stop-gate.mjs
// Pure, I/O-free gate logic for the codex-pair Stop hook (#142, ADR-118).
// No workspace imports — the hook ships without node_modules.

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
