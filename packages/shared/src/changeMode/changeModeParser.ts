import { Logger } from "../logger.js";

export interface ChangeModeEdit {
  filename: string;
  oldStartLine: number;
  oldEndLine: number;
  oldCode: string;
  newStartLine: number;
  newEndLine: number;
  newCode: string;
}

// Both edit formats used to be matched with backtracking regexes:
//
//   markdown: /\*\*FILE:\s*(.+?):(\d+)\*\*\s*\n```\s*\nOLD:\s*\n([\s\S]*?)\nNEW:\s*\n([\s\S]*?)\n```/g
//   legacy:   /\/old\/ \* (.+?) 'start:' (\d+)\n([\s\S]*?)\n\/\/ 'end:' (\d+)\s*\n\s*\\new\\ \* (.+?) 'start:' (\d+)\n([\s\S]*?)\n\/\/ 'end:' (\d+)/g
//
// Their overlapping quantifiers (`\s*` next to `.+?` or `\n`, and lazy bodies retried from
// every candidate start) took quadratic time on crafted model output (code-scanning
// js/polynomial-redos). The scanners below return exactly what those regexes returned, choice
// for choice in backtracking order, but in linear time: every "does the rest of the pattern
// match from here?" question depends only on a position, so it is answered once per position
// in a right-to-left table (see buildNextIndex) instead of being re-run by backtracking.
// A differential test pins this equivalence against the original regexes.

const NONE = -1;
const MARKDOWN_HEADER = "**FILE:";
const LEGACY_OLD_HEADER = "/old/ * ";
const LEGACY_NEW_HEADER = "\\new\\ * ";
const LEGACY_START_TAG = " 'start:' ";
const LEGACY_END_TAG = "\n// 'end:' ";
const WHITESPACE = /\s/;

function isWhitespace(text: string, i: number): boolean {
  return i < text.length && WHITESPACE.test(text[i]);
}

// The characters regex `.` refuses without the `s` flag.
function isLineTerminator(text: string, i: number): boolean {
  const ch = text[i];
  return ch === "\n" || ch === "\r" || ch === " " || ch === " ";
}

function isDigit(text: string, i: number): boolean {
  const code = text.charCodeAt(i);
  return code >= 48 && code <= 57;
}

function skipWhitespace(text: string, i: number): number {
  let end = i;
  while (isWhitespace(text, end)) end++;
  return end;
}

function skipDigits(text: string, i: number): number {
  let end = i;
  while (isDigit(text, end)) end++;
  return end;
}

// Index of the last "\n" in text[from, to), or NONE.
function lastNewline(text: string, from: number, to: number): number {
  for (let i = to - 1; i >= from; i--) {
    if (text[i] === "\n") return i;
  }
  return NONE;
}

// next[i] is the smallest j >= i with matchesAt(j), or NONE. Filled right to left so each
// position's predicate runs once; predicates may read tables built before this one.
function buildNextIndex(length: number, matchesAt: (i: number) => boolean): Int32Array {
  const next = new Int32Array(length + 1);
  next[length] = NONE;
  for (let i = length - 1; i >= 0; i--) {
    next[i] = matchesAt(i) ? i : next[i + 1];
  }
  return next;
}

function lookup(next: Int32Array, i: number): number {
  return i < next.length ? next[i] : NONE;
}

// The `g`-flag exec loop: try each occurrence of the literal prefix, resuming after a match.
function scanMatches<T extends { end: number }>(
  text: string,
  prefix: string,
  matchAt: (start: number) => T | null,
): T[] {
  const matches: T[] = [];
  let start = text.indexOf(prefix);
  while (start !== NONE) {
    const match = matchAt(start);
    if (match) matches.push(match);
    start = text.indexOf(prefix, match ? match.end : start + 1);
  }
  return matches;
}

interface Span {
  start: number;
  end: number;
}

interface MarkdownMatch {
  filename: Span;
  startLine: Span;
  oldCode: Span;
  newCode: Span;
  end: number;
}

interface MarkdownBody {
  oldCode: Span;
  newCode: Span;
}

// For `\s*\n` followed by a lazy body: greedy `\s*` first tries the body start just after the
// LAST newline of the whitespace run, and backtracks to the newline before it only when the rest
// of the pattern fails. Returns the indexes of those two newlines (second may be NONE).
function bodyStartNewlines(text: string, wsStart: number): { last: number; previous: number } {
  const wsEnd = skipWhitespace(text, wsStart);
  const last = lastNewline(text, wsStart, wsEnd);
  return { last, previous: last === NONE ? NONE : lastNewline(text, wsStart, last) };
}

function matchMarkdownEdits(text: string): MarkdownMatch[] {
  if (!text.includes(MARKDOWN_HEADER)) return [];
  const length = text.length;

  const nextLineTerminator = buildNextIndex(length, (i) => isLineTerminator(text, i));
  const nextClosingFence = buildNextIndex(length, (i) => text.startsWith("\n```", i));

  // `\nNEW:\s*\n([\s\S]*?)\n```` at i: the NEW body span (its end is the closing "\n```").
  const newSectionAt = (i: number): Span | null => {
    if (!text.startsWith("\nNEW:", i)) return null;
    const { last, previous } = bodyStartNewlines(text, i + 5);
    if (last === NONE) return null;
    const fence = lookup(nextClosingFence, last + 1);
    if (fence !== NONE) return { start: last + 1, end: fence };
    // Backtracked `\s*`: an empty body written as "NEW:\n\n```" with no later fence.
    if (previous !== NONE && text.startsWith("\n```", last)) return { start: previous + 1, end: last };
    return null;
  };
  const nextNewSection = buildNextIndex(length, (i) => newSectionAt(i) !== null);

  // `\s*\n```\s*\nOLD:\s*\n([\s\S]*?)` + NEW section, right after the header's closing "**".
  const bodyAt = (i: number): MarkdownBody | null => {
    const fenceStart = skipWhitespace(text, i);
    if (text[fenceStart - 1] !== "\n" || !text.startsWith("```", fenceStart)) return null;
    const oldLabel = skipWhitespace(text, fenceStart + 3);
    if (text[oldLabel - 1] !== "\n" || !text.startsWith("OLD:", oldLabel)) return null;
    const { last, previous } = bodyStartNewlines(text, oldLabel + 4);
    if (last === NONE) return null;
    const newSectionStart = lookup(nextNewSection, last + 1);
    if (newSectionStart !== NONE) {
      const newCode = newSectionAt(newSectionStart) as Span;
      return { oldCode: { start: last + 1, end: newSectionStart }, newCode };
    }
    // Backtracked `\s*`: an empty body written as "OLD:\n\nNEW:" with no later NEW section.
    const newCode = previous === NONE ? null : newSectionAt(last);
    return newCode ? { oldCode: { start: previous + 1, end: last }, newCode } : null;
  };

  // `:(\d+)\*\*` + body, where i is the colon ending the filename.
  const headerTailAt = (i: number): { startLine: Span; body: MarkdownBody } | null => {
    if (text[i] !== ":") return null;
    const digitsEnd = skipDigits(text, i + 1);
    if (digitsEnd === i + 1 || !text.startsWith("**", digitsEnd)) return null;
    const body = bodyAt(digitsEnd + 2);
    return body ? { startLine: { start: i + 1, end: digitsEnd }, body } : null;
  };
  const nextHeaderTail = buildNextIndex(length, (i) => headerTailAt(i) !== null);

  const matchAt = (header: number): MarkdownMatch | null => {
    const afterLabel = header + MARKDOWN_HEADER.length;
    const nameStart = skipWhitespace(text, afterLabel);
    let filename: Span | null = null;
    // Greedy `\s*`, then the shortest single-line `(.+?)` whose tail matches.
    const nameEnd = lookup(nextHeaderTail, nameStart + 1);
    const lineEnd = lookup(nextLineTerminator, nameStart);
    if (nameStart < length && nameEnd !== NONE && (lineEnd === NONE || nameEnd < lineEnd)) {
      filename = { start: nameStart, end: nameEnd };
    } else if (nameStart > afterLabel && !isLineTerminator(text, nameStart - 1)) {
      // Backtracked `\s*`: a whitespace-only filename right before the ":<line>**".
      filename = { start: nameStart - 1, end: nameStart };
    }
    const tail = filename ? headerTailAt(filename.end) : null;
    if (!filename || !tail) return null;
    const { oldCode, newCode } = tail.body;
    return { filename, startLine: tail.startLine, oldCode, newCode, end: newCode.end + 4 };
  };

  return scanMatches(text, MARKDOWN_HEADER, matchAt);
}

interface LegacyHalf {
  filename: Span;
  startLine: Span;
  code: Span;
  endLine: Span;
}

function matchLegacyEdits(text: string): Array<{ old: LegacyHalf; new: LegacyHalf; end: number }> {
  if (!text.includes(LEGACY_OLD_HEADER)) return [];
  const length = text.length;

  const nextLineTerminator = buildNextIndex(length, (i) => isLineTerminator(text, i));

  // ` 'start:' (\d+)\n` at i: index just past the "\n", or NONE.
  const startTagEnd = (i: number): number => {
    if (!text.startsWith(LEGACY_START_TAG, i)) return NONE;
    const digitsStart = i + LEGACY_START_TAG.length;
    const digitsEnd = skipDigits(text, digitsStart);
    return digitsEnd > digitsStart && text[digitsEnd] === "\n" ? digitsEnd + 1 : NONE;
  };
  const nextStartTag = buildNextIndex(length, (i) => startTagEnd(i) !== NONE);

  // `\n\/\/ 'end:' (\d+)` at i: index just past the digits, or NONE.
  const endTagEnd = (i: number): number => {
    if (!text.startsWith(LEGACY_END_TAG, i)) return NONE;
    const digitsStart = i + LEGACY_END_TAG.length;
    const digitsEnd = skipDigits(text, digitsStart);
    return digitsEnd > digitsStart ? digitsEnd : NONE;
  };
  const nextEndTag = buildNextIndex(length, (i) => endTagEnd(i) !== NONE);

  // `(.+?) 'start:' (\d+)\n` from nameStart. Every later body search starts further right, so
  // when the first start tag on the line cannot complete the match no later one can either.
  const filenameEnd = (nameStart: number): number => {
    const nameEnd = lookup(nextStartTag, nameStart + 1);
    const lineEnd = lookup(nextLineTerminator, nameStart);
    return nameEnd !== NONE && (lineEnd === NONE || nameEnd < lineEnd) ? nameEnd : NONE;
  };

  // `(.+?) 'start:' (\d+)\n([\s\S]*?)\n\/\/ 'end:' (\d+)` from nameStart; the code body ends at
  // the first end tag, as the regex's final group does.
  const newHalfAt = (nameStart: number): LegacyHalf | null => {
    const nameEnd = filenameEnd(nameStart);
    if (nameEnd === NONE) return null;
    const codeStart = startTagEnd(nameEnd);
    const endTag = lookup(nextEndTag, codeStart);
    if (endTag === NONE) return null;
    return {
      filename: { start: nameStart, end: nameEnd },
      startLine: { start: nameEnd + LEGACY_START_TAG.length, end: codeStart - 1 },
      code: { start: codeStart, end: endTag },
      endLine: { start: endTag + LEGACY_END_TAG.length, end: endTagEnd(endTag) },
    };
  };

  // `\n\/\/ 'end:' (\d+)\s*\n\s*\\new\\ \* ` + new half at i: the end of the OLD body.
  const oldEndAt = (i: number): { endLine: Span; newHalf: LegacyHalf } | null => {
    const digitsEnd = endTagEnd(i);
    if (digitsEnd === NONE) return null;
    const wsEnd = skipWhitespace(text, digitsEnd);
    if (lastNewline(text, digitsEnd, wsEnd) === NONE || !text.startsWith(LEGACY_NEW_HEADER, wsEnd)) return null;
    const newHalf = newHalfAt(wsEnd + LEGACY_NEW_HEADER.length);
    return newHalf ? { endLine: { start: i + LEGACY_END_TAG.length, end: digitsEnd }, newHalf } : null;
  };
  const nextOldEnd = buildNextIndex(length, (i) => oldEndAt(i) !== null);

  const matchAt = (header: number): { old: LegacyHalf; new: LegacyHalf; end: number } | null => {
    const nameStart = header + LEGACY_OLD_HEADER.length;
    const nameEnd = filenameEnd(nameStart);
    if (nameEnd === NONE) return null;
    const codeStart = startTagEnd(nameEnd);
    const oldEnd = lookup(nextOldEnd, codeStart);
    if (oldEnd === NONE) return null;
    const { endLine, newHalf } = oldEndAt(oldEnd) as { endLine: Span; newHalf: LegacyHalf };
    const oldHalf: LegacyHalf = {
      filename: { start: nameStart, end: nameEnd },
      startLine: { start: nameEnd + LEGACY_START_TAG.length, end: codeStart - 1 },
      code: { start: codeStart, end: oldEnd },
      endLine,
    };
    return { old: oldHalf, new: newHalf, end: newHalf.endLine.end };
  };

  return scanMatches(text, LEGACY_OLD_HEADER, matchAt);
}

export function parseChangeModeOutput(geminiResponse: string): ChangeModeEdit[] {
  const edits: ChangeModeEdit[] = [];
  const slice = (span: Span) => geminiResponse.slice(span.start, span.end);

  for (const match of matchMarkdownEdits(geminiResponse)) {
    const filename = slice(match.filename);
    const startLineStr = slice(match.startLine);
    const oldCodeRaw = slice(match.oldCode);
    const newCodeRaw = slice(match.newCode);

    const oldCode = oldCodeRaw.trimEnd();
    const newCode = newCodeRaw.trimEnd();
    const startLine = parseInt(startLineStr, 10);

    const oldLineCount = oldCode === "" ? 0 : oldCode.split("\n").length;
    const newLineCount = newCode === "" ? 0 : newCode.split("\n").length;

    const oldEndLine = startLine + (oldLineCount > 0 ? oldLineCount - 1 : 0);

    const newStartLine = startLine;
    const newEndLine = newStartLine + (newLineCount > 0 ? newLineCount - 1 : 0);

    edits.push({
      filename: filename.trim(),
      oldStartLine: startLine,
      oldEndLine: oldEndLine,
      oldCode: oldCode,
      newStartLine: newStartLine,
      newEndLine: newEndLine,
      newCode: newCode,
    });
  }

  if (edits.length === 0) {
    for (const match of matchLegacyEdits(geminiResponse)) {
      const oldFilename = slice(match.old.filename);
      const newFilename = slice(match.new.filename);

      if (oldFilename === newFilename) {
        edits.push({
          filename: oldFilename.trim(),
          oldStartLine: parseInt(slice(match.old.startLine), 10),
          oldEndLine: parseInt(slice(match.old.endLine), 10),
          oldCode: slice(match.old.code).trimEnd(),
          newStartLine: parseInt(slice(match.new.startLine), 10),
          newEndLine: parseInt(slice(match.new.endLine), 10),
          newCode: slice(match.new.code).trimEnd(),
        });
      } else {
        Logger.warn(`[changeModeParser] Filename mismatch: ${oldFilename} vs ${newFilename}`);
      }
    }
  }

  return edits;
}
export function validateChangeModeEdits(edits: ChangeModeEdit[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  for (const edit of edits) {
    if (!edit.filename) {
      errors.push("Edit missing filename");
    }

    if (edit.oldStartLine > edit.oldEndLine) {
      errors.push(`Invalid line range for ${edit.filename}: ${edit.oldStartLine} > ${edit.oldEndLine}`);
    }

    if (edit.newStartLine > edit.newEndLine) {
      errors.push(`Invalid new line range for ${edit.filename}: ${edit.newStartLine} > ${edit.newEndLine}`);
    }

    if (!edit.oldCode && !edit.newCode) {
      errors.push(`Empty edit for ${edit.filename}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
