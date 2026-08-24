// Concern parsing + verdict-message formatting (extracted from
// codex-pair-watch.mjs per ADR-088, originally ADR-077/ADR-083).
//
// Pure functions over strings → easy to unit-test. JSON-first parser
// (ADR-083 contract) with a legacy regex fallback for defense-in-depth.

export const VERDICT_PREFIXES = {
  none: "OK",
  concerns: "WARN",
  skipped: "SKIP",
  error: "ERROR",
  spawn_failed: "SPAWN_FAILED",
  timeout: "TIMEOUT",
  parse_failed: "PARSE_FAILED",
  cached: "CACHED",
};

export const SEVERITY_TO_BUCKET = {
  high: "high",
  medium: "med",
  med: "med",
  low: "low",
};

export const VALID_THRESHOLDS = new Set(["high", "med", "low"]);
export const DEFAULT_SURFACE_THRESHOLD = "med";

export function formatDuration(durationMs) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

// Build the systemMessage payload. `surfaceThreshold` controls which concern
// levels are expanded into the message body. ADR-077 default keeps LOW in the
// log only (threshold = "med"). The only opt-up is surfaceThreshold = "low";
// the count summary line always includes LOW so the user knows LOWs exist.
//
// ADR-096 (codex-pair UX improvements): when `repeatedIgnoredCount > 0`,
// the message is prefixed with a loud BLOCKING-tier banner so the
// consumer cannot silently ignore findings that have been flagged 3+
// times in a row (poor-man's STOPPER mode — Claude Code's PostToolUse
// hook can't actually block the next tool call, but bright formatting
// makes the message un-scrollable-past in flow).
export function buildVerdictMessage({
  filePath,
  concerns,
  fellBack,
  durationMs,
  surfaceThreshold,
  cached,
  repeatedIgnoredCount = 0,
  logPath,
}) {
  const threshold = VALID_THRESHOLDS.has(surfaceThreshold) ? surfaceThreshold : DEFAULT_SURFACE_THRESHOLD;
  const total = concerns.high.length + concerns.med.length + concerns.low.length;
  const flag = fellBack ? " [fallback model]" : "";
  const cachedTag = cached ? " [cached]" : "";
  // #96 Idea 2: a fast pointer to the durable log (for LOWs kept out of the
  // message body, and to confirm "codex did look") — appended to the header line.
  const logPointer = logPath ? ` → see ${logPath}` : "";
  if (total === 0) {
    return `codex-pair ${VERDICT_PREFIXES.none}${flag}${cachedTag}: ${filePath} — no concerns (${formatDuration(durationMs)})${logPointer}`;
  }
  const counts = `${concerns.high.length}H / ${concerns.med.length}M / ${concerns.low.length}L`;
  const header = `codex-pair ${VERDICT_PREFIXES.concerns}${flag}${cachedTag}: ${filePath} — ${counts} (${formatDuration(durationMs)})${logPointer}`;
  const details = [];
  for (const c of concerns.high) details.push(`[HIGH]\n${c}`);
  if (threshold === "med" || threshold === "low") {
    for (const c of concerns.med) details.push(`[MED]\n${c}`);
  }
  if (threshold === "low") {
    for (const c of concerns.low) details.push(`[LOW]\n${c}`);
  }
  const body = details.length > 0 ? `${header}\n\n${details.join("\n\n")}` : header;
  // ADR-096: loud BLOCKING banner when repeated-ignored findings exist.
  if (repeatedIgnoredCount > 0) {
    const banner = [
      "🛑 ═══════════════════════════════════════════════════════════════",
      `🛑 REPEATED-IGNORED FINDING — ${repeatedIgnoredCount} concern${repeatedIgnoredCount === 1 ? " has" : "s have"} been flagged 3+ times`,
      "🛑 without being fixed. This is no longer advisory — please address",
      "🛑 the concerns below BEFORE continuing edits on this file.",
      "🛑 ═══════════════════════════════════════════════════════════════",
      "",
    ].join("\n");
    return banner + body;
  }
  return body;
}

// Three-stage JSON extractor: raw parse → strip code fences → walk for the
// first balanced top-level object (string-aware brace counter).
export function tryExtractJson(message) {
  const trimmed = message.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {}
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {}
  }
  const start = trimmed.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      else if (!inString && ch === "{") depth++;
      else if (!inString && ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

export function formatFindingBody(finding) {
  const parts = [];
  if (typeof finding.title === "string" && finding.title.trim().length > 0) {
    parts.push(finding.title.trim());
  }
  const file = typeof finding.file === "string" ? finding.file.trim() : "";
  const line = Number.isFinite(finding.line_start) ? `:${finding.line_start}` : "";
  const body = typeof finding.body === "string" ? finding.body.trim() : "";
  const fileLine = file ? `${file}${line}` : "";
  if (fileLine && body) parts.push(`${fileLine}: ${body}`);
  else if (fileLine) parts.push(fileLine);
  else if (body) parts.push(body);
  if (typeof finding.recommendation === "string" && finding.recommendation.trim().length > 0) {
    parts.push(finding.recommendation.trim());
  }
  return parts.join("\n");
}

export function parseConcernsJson(message) {
  const obj = tryExtractJson(message);
  if (!obj || typeof obj !== "object") return null;
  if (obj.verdict === "clean") {
    return { high: [], med: [], low: [] };
  }
  if (!Array.isArray(obj.findings)) return null;
  const concerns = { high: [], med: [], low: [] };
  for (const f of obj.findings) {
    if (!f || typeof f !== "object") continue;
    const sev = typeof f.severity === "string" ? f.severity.toLowerCase() : "";
    const bucket = SEVERITY_TO_BUCKET[sev];
    if (!bucket) continue;
    const rendered = formatFindingBody(f);
    if (rendered.length === 0) continue;
    concerns[bucket].push(rendered);
  }
  return concerns;
}

export function parseConcernsLegacy(message) {
  const trimmed = message.trim();
  const upper = trimmed.toUpperCase();
  if (upper === "NONE" || upper.startsWith("NONE\n")) {
    return { high: [], med: [], low: [] };
  }
  const parts = trimmed.split(/(?=\[(?:HIGH|MED|LOW)\])/);
  const concerns = { high: [], med: [], low: [] };
  for (const part of parts) {
    const labelMatch = part.match(/^\[(HIGH|MED|LOW)\]/);
    if (!labelMatch) continue;
    const body = part.slice(labelMatch[0].length).trim();
    if (body.length === 0) continue;
    const label = labelMatch[1].toLowerCase();
    if (label === "high") concerns.high.push(body);
    else if (label === "med") concerns.med.push(body);
    else if (label === "low") concerns.low.push(body);
  }
  return concerns;
}

export function parseConcerns(message) {
  const fromJson = parseConcernsJson(message);
  if (fromJson) return fromJson;
  return parseConcernsLegacy(message);
}

// ── Reset-hint extraction (#176 / ADR-120) ────────────────────────────────
// Best-effort, DISPLAY-ONLY parse of "when does the quota reset" from a
// provider error message. Never used for timestamp math — resume is manual;
// the hint just makes the one-time auto-pause notice actionable. The capture
// stops at `.` (see RESET_HINT_PATTERNS), so decimal-fraction phrasings like
// "1.5 hours" yield null rather than a partial hint — an accepted limitation:
// a missing hint degrades cleanly to a hint-less notice, and integer-unit
// phrasings ("3 hours 25 minutes") are the common provider format.
const RESET_HINT_PATTERNS = [/try again (?:in|at|after)\s+([^.()\n]+)/i, /\bresets?\s+(?:in|at|after)\s+([^.()\n]+)/i];
const RESET_HINT_MAX_CHARS = 80;

export function parseResetHint(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  for (const re of RESET_HINT_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const hint = m[1]
        .trim()
        .replace(/[,;].*$/, "")
        .trim();
      // Reject bare-numeric captures: "try again in 1.928s." (the standard
      // OpenAI rate-limit phrasing) truncates at the decimal point to "1",
      // a misleading false positive. Real reset hints always carry units
      // or separators ("30s", "3 hours", "14:30 UTC").
      if (/^\d+$/.test(hint)) continue;
      if (hint.length > 0 && hint.length <= RESET_HINT_MAX_CHARS) return hint;
    }
  }
  return null;
}
