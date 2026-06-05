// Date-gated tier-discontinuation guidance for the 2026-06-18 Gemini CLI
// free/Pro/Ultra cutoff (#140, design 2026-06-05). Pure + total: no executor
// deps, no I/O beyond reading ASK_GEMINI_TIER_CUTOFF. The classifier runs on a
// RAW single error string; the formatter is gated on date + class and prepends
// the note. See ERROR_MESSAGES.TIER_DISCONTINUED.

import {
  ERROR_MESSAGES,
  GEMINI_TIER_CUTOFF_DEFAULT,
  OPERATIONAL_PATTERNS,
  QUOTA_PATTERNS,
  TIER_ACCESS_PATTERNS,
  TIER_NOTE_MARKER,
  WORKSPACE_TRUST_PATTERNS,
} from "../constants.js";

export type GeminiErrorClass = "workspaceTrust" | "quota" | "tierAccess" | "operational" | "unknown";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary, case-insensitive match — so loose terms ("tier", "401")
// don't match mid-word ("frontier", "1401").
function matchesAny(message: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => new RegExp(`\\b${escapeRegex(p)}\\b`, "i").test(message));
}

// Classify a RAW single error string. Order: most-specific first. quota stays
// the narrow Flash-fallback class; tierAccess is the post-cutoff signature.
export function classifyGeminiCliError(raw: string): GeminiErrorClass {
  if (!raw) return "unknown";
  if (matchesAny(raw, WORKSPACE_TRUST_PATTERNS)) return "workspaceTrust";
  if (matchesAny(raw, QUOTA_PATTERNS)) return "quota";
  if (matchesAny(raw, TIER_ACCESS_PATTERNS)) return "tierAccess";
  if (matchesAny(raw, OPERATIONAL_PATTERNS)) return "operational";
  return "unknown";
}

// Resolve the cutoff: ASK_GEMINI_TIER_CUTOFF override (invalid → default).
export function resolveTierCutoff(): Date {
  const raw = process.env.ASK_GEMINI_TIER_CUTOFF;
  const candidate = raw ? new Date(raw) : new Date(GEMINI_TIER_CUTOFF_DEFAULT);
  return Number.isNaN(candidate.getTime()) ? new Date(GEMINI_TIER_CUTOFF_DEFAULT) : candidate;
}

// Pure formatter. Prepends the tier note iff now ≥ cutoff AND the class is
// quota/tierAccess AND the marker isn't already present. Otherwise unchanged.
export function formatTierNote(
  message: string,
  classification: GeminiErrorClass,
  now: Date,
  cutoff: Date,
): string {
  if (now.getTime() < cutoff.getTime()) return message;
  if (classification !== "quota" && classification !== "tierAccess") return message;
  if (message.includes(TIER_NOTE_MARKER)) return message;
  return `${ERROR_MESSAGES.TIER_DISCONTINUED}\n\n--- technical details ---\n${message}`;
}
