#!/usr/bin/env node
// codex-pair-log — standalone CLI viewer for .codex-pair/log.jsonl written
// by the codex-pair PostToolUse hook. Walks up from cwd to find the
// .codex-pair/context.md marker (same gate as the hook), then reads and
// renders the sibling log file.
//
// Subcommands:
//   --latest [N]      Show last N entries (default 10). DEFAULT subcommand.
//   --summary         Aggregate stats: verdict breakdown, top files, durations.
//   --file <path>     Filter to one file's history.
//   --since <dur>     Filter to entries within the last <dur>. Examples: 24h, 7d, 30m.
//
// Zero workspace imports — distributed via marketplace `git-subdir` install,
// no node_modules at runtime. Same constraint as codex-pair-watch.mjs (ADR-078).
// Path constants come from the sibling lib/state.mjs so the layout stays
// consistent with the hook (ADR-092).

import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CONTEXT_FILENAME, PAIR_ROOT_DIR, logPath as resolveLogPath } from "./lib/state.mjs";

const MARKER_FILE = join(PAIR_ROOT_DIR, CONTEXT_FILENAME);

// Returns the project ROOT (the directory holding `.codex-pair/`) or null.
async function findMarkerUp(startDir) {
  const home = homedir();
  let current = resolve(startDir);
  for (let depth = 0; depth < 20; depth++) {
    const candidate = join(current, MARKER_FILE);
    try {
      await access(candidate);
      return current;
    } catch {
      // not found here
    }
    const parent = dirname(current);
    if (parent === current) return null;
    if (current === home) return null;
    current = parent;
  }
  return null;
}

function parseDuration(s) {
  const m = s.match(/^(\d+)([smhd])$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  if (unit === "d") return n * 24 * 60 * 60 * 1000;
  return null;
}

function parseArgs(argv) {
  const args = { cmd: "latest", n: 10, file: null, sinceMs: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--latest") {
      args.cmd = "latest";
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) {
        args.n = Number(next);
        i++;
      }
    } else if (a === "--summary") {
      args.cmd = "summary";
    } else if (a === "--file") {
      args.cmd = "file";
      args.file = argv[i + 1] ?? null;
      i++;
    } else if (a === "--since") {
      const next = argv[i + 1];
      const ms = next ? parseDuration(next) : null;
      if (ms === null) {
        process.stderr.write(`codex-pair-log: invalid --since duration "${next ?? ""}"\n`);
        process.exit(2);
      }
      args.sinceMs = ms;
      i++;
    } else if (a === "--help" || a === "-h") {
      args.cmd = "help";
    } else {
      process.stderr.write(`codex-pair-log: unknown arg "${a}"\n`);
      process.exit(2);
    }
  }
  return args;
}

function loadEntries(logPath) {
  let content;
  try {
    content = readFileSync(logPath, "utf8");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines silently
    }
  }
  return entries;
}

function applySinceFilter(entries, sinceMs) {
  if (sinceMs == null) return entries;
  const cutoff = Date.now() - sinceMs;
  return entries.filter((e) => {
    if (!e.timestamp) return false;
    const t = new Date(e.timestamp).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

function formatCounts(entry) {
  if (entry.counts) {
    return `${entry.counts.high}H/${entry.counts.med}M/${entry.counts.low}L`;
  }
  return "—";
}

function formatDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function showLatest(entries, n) {
  const slice = entries.slice(-n);
  for (const e of slice) {
    const verdict = (e.verdict || (e.level ? `[${e.level}]` : "?")).padEnd(13);
    const file = (e.file || "—").padEnd(50);
    const counts = formatCounts(e).padEnd(11);
    const dur = formatDuration(e.durationMs);
    const ts = e.timestamp || "—";
    process.stdout.write(`${ts}  ${verdict} ${file} ${counts} ${dur}\n`);
  }
}

function showFile(entries, filePath) {
  const filtered = entries.filter((e) => e.file === filePath);
  if (filtered.length === 0) {
    process.stdout.write(`codex-pair-log: no entries for file ${filePath}\n`);
    return;
  }
  showLatest(filtered, filtered.length);
}

function showSummary(entries) {
  const verdictCounts = {};
  const fileCounts = {};
  let durationSum = 0;
  let durationCount = 0;
  let fallbackCount = 0;
  let cachedCount = 0;
  let runCount = 0;
  for (const e of entries) {
    if (e.verdict) {
      verdictCounts[e.verdict] = (verdictCounts[e.verdict] || 0) + 1;
    }
    if (e.file) {
      fileCounts[e.file] = (fileCounts[e.file] || 0) + 1;
    }
    if (e.fellBack) fallbackCount++;
    if (e.verdict === "cached") cachedCount++;
    if (e.verdict === "none" || e.verdict === "concerns" || e.verdict === "cached") {
      runCount++;
    }
    if (e.durationMs != null && (e.verdict === "none" || e.verdict === "concerns")) {
      durationSum += e.durationMs;
      durationCount++;
    }
  }
  const topFiles = Object.entries(fileCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  process.stdout.write(`codex-pair log summary\n`);
  process.stdout.write(`Total entries:    ${entries.length}\n`);
  process.stdout.write(`Verdict breakdown:\n`);
  for (const [v, c] of Object.entries(verdictCounts).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${v.padEnd(15)} ${c}\n`);
  }
  process.stdout.write(`Top 5 files by entry count:\n`);
  for (const [f, c] of topFiles) {
    process.stdout.write(`  ${String(c).padStart(4)}  ${f}\n`);
  }
  if (durationCount > 0) {
    const avg = durationSum / durationCount;
    process.stdout.write(
      `Average codex duration (uncached runs only): ${formatDuration(avg)} over ${durationCount} runs\n`,
    );
  }
  if (runCount > 0) {
    const cacheRate = ((cachedCount / runCount) * 100).toFixed(1);
    process.stdout.write(`Cache hit rate: ${cachedCount} / ${runCount} (${cacheRate}%)\n`);
  }
  if (fallbackCount > 0) {
    process.stdout.write(`Fallback model used: ${fallbackCount} time(s)\n`);
  }
}

function showHelp() {
  process.stdout.write(
    [
      "codex-pair-log — view .codex-pair/log.jsonl written by the codex-pair hook",
      "",
      "Usage: codex-pair-log [SUBCOMMAND] [--since DURATION]",
      "",
      "Subcommands:",
      "  --latest [N]      Show last N entries (default 10). Default subcommand.",
      "  --summary         Aggregate stats over the log.",
      "  --file <path>     Filter to one file's history.",
      "  --since <dur>     Filter to entries within the last <dur>. Examples: 30m, 24h, 7d.",
      "  --help, -h        Show this help.",
      "",
    ].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === "help") {
    showHelp();
    return;
  }
  const markerDir = await findMarkerUp(process.cwd());
  if (!markerDir) {
    process.stderr.write(`codex-pair-log: no .codex-pair/context.md marker found in cwd or parents\n`);
    process.exit(1);
  }
  const logPath = resolveLogPath(markerDir);
  let entries = loadEntries(logPath);
  if (entries.length === 0) {
    process.stdout.write(`codex-pair-log: no entries in ${logPath}\n`);
    return;
  }
  entries = applySinceFilter(entries, args.sinceMs);
  if (args.cmd === "latest") {
    showLatest(entries, args.n);
  } else if (args.cmd === "summary") {
    showSummary(entries);
  } else if (args.cmd === "file") {
    if (!args.file) {
      process.stderr.write(`codex-pair-log: --file requires a path argument\n`);
      process.exit(2);
    }
    showFile(entries, args.file);
  }
}

main().catch((err) => {
  process.stderr.write(`codex-pair-log: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
