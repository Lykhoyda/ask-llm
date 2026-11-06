import { describe, expect, it } from "vitest";
import { type ChangeModeEdit, parseChangeModeOutput, validateChangeModeEdits } from "../changeModeParser.js";

// The regex implementation parseChangeModeOutput replaced (code-scanning js/polynomial-redos
// alerts 14-17). Kept verbatim as the oracle: the linear-time scanner must agree with it on every
// input, including the malformed ones its backtracking resolved in surprising ways.
function regexParseChangeModeOutput(geminiResponse: string): ChangeModeEdit[] {
  const edits: ChangeModeEdit[] = [];
  const markdownPattern = /\*\*FILE:\s*(.+?):(\d+)\*\*\s*\n```\s*\nOLD:\s*\n([\s\S]*?)\nNEW:\s*\n([\s\S]*?)\n```/g;
  let match: RegExpExecArray | null = markdownPattern.exec(geminiResponse);
  while (match !== null) {
    const [, filename, startLineStr, oldCodeRaw, newCodeRaw] = match;
    const oldCode = oldCodeRaw.trimEnd();
    const newCode = newCodeRaw.trimEnd();
    const startLine = parseInt(startLineStr, 10);
    const oldLineCount = oldCode === "" ? 0 : oldCode.split("\n").length;
    const newLineCount = newCode === "" ? 0 : newCode.split("\n").length;
    edits.push({
      filename: filename.trim(),
      oldStartLine: startLine,
      oldEndLine: startLine + (oldLineCount > 0 ? oldLineCount - 1 : 0),
      oldCode,
      newStartLine: startLine,
      newEndLine: startLine + (newLineCount > 0 ? newLineCount - 1 : 0),
      newCode,
    });
    match = markdownPattern.exec(geminiResponse);
  }
  if (edits.length === 0) {
    const editPattern =
      /\/old\/ \* (.+?) 'start:' (\d+)\n([\s\S]*?)\n\/\/ 'end:' (\d+)\s*\n\s*\\new\\ \* (.+?) 'start:' (\d+)\n([\s\S]*?)\n\/\/ 'end:' (\d+)/g;
    match = editPattern.exec(geminiResponse);
    while (match !== null) {
      const [, oldFilename, oldStartLine, oldCode, oldEndLine, newFilename, newStartLine, newCode, newEndLine] = match;
      if (oldFilename === newFilename) {
        edits.push({
          filename: oldFilename.trim(),
          oldStartLine: parseInt(oldStartLine, 10),
          oldEndLine: parseInt(oldEndLine, 10),
          oldCode: oldCode.trimEnd(),
          newStartLine: parseInt(newStartLine, 10),
          newEndLine: parseInt(newEndLine, 10),
          newCode: newCode.trimEnd(),
        });
      }
      match = editPattern.exec(geminiResponse);
    }
  }
  return edits;
}

// Deterministic PRNG (mulberry32) so a differential failure reproduces from its seed.
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WHITESPACE_PIECES = [" ", "\n", " \n ", "\n\n", "\t", "\r\n", "\n  ", " \n\n  "];
const BODY_LINES = ["x", "  y", "\tz", "", "NEW:", "OLD:", "```", "``", "**FILE: c:3**", "// 'end:' 2", "a\\b"];

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

// Mostly the well-formed piece, sometimes a near miss.
function vary(random: () => number, valid: string, nearMisses: readonly string[]): string {
  return random() < 0.85 ? valid : pick(random, nearMisses);
}

function bodyPieces(random: () => number): string[] {
  const lines = Array.from({ length: Math.floor(random() * 3) }, () => vary(random, "x", BODY_LINES));
  return lines.flatMap((line, index) => (index === 0 ? [line] : ["\n", line]));
}

function markdownBlock(random: () => number): string[] {
  const ws = () => vary(random, "", WHITESPACE_PIECES);
  const newline = () => vary(random, "\n", ["", " ", "\n\n"]);
  return [
    "**FILE:",
    vary(random, " ", WHITESPACE_PIECES),
    vary(random, "a.ts", ["", " ", "x:1", "b c", ":", "a.ts:9** z"]),
    vary(random, ":", ["", "::"]),
    vary(random, "42", ["", "7a"]),
    vary(random, "**", ["*", ""]),
    ws(),
    newline(),
    vary(random, "```", ["``", "```ts"]),
    ws(),
    newline(),
    vary(random, "OLD:", ["OLD", ""]),
    ws(),
    newline(),
    ...bodyPieces(random),
    newline(),
    vary(random, "NEW:", ["NEW", ""]),
    ws(),
    newline(),
    ...bodyPieces(random),
    newline(),
    vary(random, "```", ["``", ""]),
  ];
}

function legacyBlock(random: () => number): string[] {
  const name = () => vary(random, "a.ts", ["b.ts", "", " ", "x 'start:' 1"]);
  const digits = () => vary(random, "1", ["23", "", "4x"]);
  return [
    vary(random, "/old/ * ", ["/old/ *", ""]),
    name(),
    vary(random, " 'start:' ", [" 'start:'", ""]),
    digits(),
    vary(random, "\n", ["", " "]),
    ...bodyPieces(random),
    vary(random, "\n", ["", " "]),
    vary(random, "// 'end:' ", ["// 'end:'", ""]),
    digits(),
    vary(random, "\n", WHITESPACE_PIECES),
    vary(random, "\\new\\ * ", ["\\new\\ *", ""]),
    name(),
    vary(random, " 'start:' ", [""]),
    digits(),
    vary(random, "\n", ["", " "]),
    ...bodyPieces(random),
    vary(random, "\n", [""]),
    vary(random, "// 'end:' ", [""]),
    digits(),
  ];
}

// One to three near-valid blocks with junk between them, then a random token dropped or
// duplicated so the malformed shapes that drive regex backtracking are well covered.
function generateResponse(random: () => number): string {
  const block = random() < 0.5 ? markdownBlock : legacyBlock;
  const pieces: string[] = [];
  const blockCount = 1 + Math.floor(random() * 3);
  for (let i = 0; i < blockCount; i++) {
    pieces.push(vary(random, "\n\n", ["", "\n", "text ", "**"]));
    pieces.push(...block(random));
  }
  const mutation = random();
  const index = Math.floor(random() * pieces.length);
  if (mutation < 0.2) pieces.splice(index, 1);
  else if (mutation < 0.4) pieces.splice(index, 0, pieces[index] ?? "");
  return pieces.join("");
}

describe("parseChangeModeOutput", () => {
  it("parses markdown format edits", () => {
    const input = `Some preamble text

**FILE: src/index.ts:10**
\`\`\`
OLD:
const x = 1;
const y = 2;
NEW:
const x = 10;
const y = 20;
const z = 30;
\`\`\`

More text here`;

    const edits = parseChangeModeOutput(input);

    expect(edits).toHaveLength(1);
    expect(edits[0].filename).toBe("src/index.ts");
    expect(edits[0].oldStartLine).toBe(10);
    expect(edits[0].oldEndLine).toBe(11);
    expect(edits[0].oldCode).toBe("const x = 1;\nconst y = 2;");
    expect(edits[0].newStartLine).toBe(10);
    expect(edits[0].newEndLine).toBe(12);
    expect(edits[0].newCode).toBe("const x = 10;\nconst y = 20;\nconst z = 30;");
  });

  it("parses multiple markdown format edits", () => {
    const input = `**FILE: a.ts:1**
\`\`\`
OLD:
line1
NEW:
line1_new
\`\`\`

**FILE: b.ts:5**
\`\`\`
OLD:
line5
NEW:
line5_new
\`\`\``;

    const edits = parseChangeModeOutput(input);

    expect(edits).toHaveLength(2);
    expect(edits[0].filename).toBe("a.ts");
    expect(edits[0].oldStartLine).toBe(1);
    expect(edits[1].filename).toBe("b.ts");
    expect(edits[1].oldStartLine).toBe(5);
  });

  it("returns empty array for empty string", () => {
    expect(parseChangeModeOutput("")).toEqual([]);
  });

  it("returns empty array for text with no edit patterns", () => {
    expect(parseChangeModeOutput("Just some regular text\nwith no edits")).toEqual([]);
  });

  it("parses legacy format edits when markdown format not found", () => {
    const input = `/old/ * src/app.ts 'start:' 5
const a = 1;
// 'end:' 5
\\new\\ * src/app.ts 'start:' 5
const a = 2;
// 'end:' 5`;

    const edits = parseChangeModeOutput(input);

    expect(edits).toHaveLength(1);
    expect(edits[0].filename).toBe("src/app.ts");
    expect(edits[0].oldStartLine).toBe(5);
    expect(edits[0].oldEndLine).toBe(5);
    expect(edits[0].oldCode).toBe("const a = 1;");
    expect(edits[0].newStartLine).toBe(5);
    expect(edits[0].newEndLine).toBe(5);
    expect(edits[0].newCode).toBe("const a = 2;");
  });

  it("skips a legacy-format edit with mismatched filenames without hanging", () => {
    // A rename emits differing old/new filenames. The parser must skip it and
    // return — never spin forever (regression: the `continue` that never
    // advanced the regex iterator).
    const input = `/old/ * a.ts 'start:' 1
const a = 1;
// 'end:' 1
\\new\\ * b.ts 'start:' 1
const a = 2;
// 'end:' 1`;

    expect(parseChangeModeOutput(input)).toEqual([]);
  });

  it("keeps parsing valid legacy edits that follow a mismatched one", () => {
    const input = `/old/ * a.ts 'start:' 1
const a = 1;
// 'end:' 1
\\new\\ * b.ts 'start:' 1
const a = 2;
// 'end:' 1
/old/ * c.ts 'start:' 3
const c = 1;
// 'end:' 3
\\new\\ * c.ts 'start:' 3
const c = 2;
// 'end:' 3`;

    const edits = parseChangeModeOutput(input);

    expect(edits).toHaveLength(1);
    expect(edits[0].filename).toBe("c.ts");
    expect(edits[0].newCode).toBe("const c = 2;");
  });

  it("handles single-line old code in markdown format", () => {
    const input = `**FILE: x.ts:42**
\`\`\`
OLD:
single line
NEW:
replaced line
\`\`\``;

    const edits = parseChangeModeOutput(input);

    expect(edits).toHaveLength(1);
    expect(edits[0].oldStartLine).toBe(42);
    expect(edits[0].oldEndLine).toBe(42);
    expect(edits[0].newStartLine).toBe(42);
    expect(edits[0].newEndLine).toBe(42);
  });

  it("trims whitespace from filename", () => {
    const input = `**FILE:  src/utils/helper.ts :20**
\`\`\`
OLD:
old
NEW:
new
\`\`\``;

    const edits = parseChangeModeOutput(input);

    expect(edits).toHaveLength(1);
    expect(edits[0].filename).toBe("src/utils/helper.ts");
  });
});

describe("parseChangeModeOutput regex equivalence", () => {
  it("matches the original regex parser on generated well-formed and malformed responses", () => {
    const random = createRandom(0x5eed);
    let parsedMarkdown = 0;
    let parsedLegacy = 0;
    for (let i = 0; i < 20000; i++) {
      const input = generateResponse(random);
      const expected = regexParseChangeModeOutput(input);
      expect(parseChangeModeOutput(input), JSON.stringify(input)).toEqual(expected);
      if (expected.length > 0 && input.includes("**FILE:")) parsedMarkdown++;
      if (expected.length > 0 && !input.includes("**FILE:")) parsedLegacy++;
    }
    // Guard against a generator that stops producing parseable edits in either format.
    expect(parsedMarkdown).toBeGreaterThan(2000);
    expect(parsedLegacy).toBeGreaterThan(1000);
  });

  it.each([
    ["empty OLD body", "**FILE: a.ts:1**\n```\nOLD:\n\nNEW:\nadded\n```"],
    ["empty NEW body", "**FILE: a.ts:1**\n```\nOLD:\nremoved\nNEW:\n\n```"],
    [
      "empty OLD body followed by another block (backtracking spans both)",
      "**FILE: a.ts:1**\n```\nOLD:\n\nNEW:\nx\n```\n**FILE: b.ts:2**\n```\nOLD:\ny\nNEW:\nz\n```",
    ],
    ["blank lines before indented OLD code", "**FILE: a.ts:3**\n```\nOLD:\n\n    indented\nNEW:\n  new\n```"],
    ["whitespace-only filename", "**FILE:  :4**\n```\nOLD:\nx\nNEW:\ny\n```"],
    ["filename on the line after the label", "**FILE:\n a.ts:5**\n```\nOLD:\nx\nNEW:\ny\n```"],
    ["header text before a later valid tail", "**FILE: a.ts:1** b.ts:2**\n```\nOLD:\nx\nNEW:\ny\n```"],
    ["CRLF line endings", "**FILE: a.ts:6**\r\n```\r\nOLD:\r\nx\r\nNEW:\r\ny\r\n```"],
    ["unterminated NEW body", "**FILE: a.ts:7**\n```\nOLD:\nx\nNEW:\ny"],
    [
      "legacy edit separated by blank lines",
      "/old/ * a.ts 'start:' 1\nx\n// 'end:' 1 \n\n  \\new\\ * a.ts 'start:' 1\ny\n// 'end:' 12",
    ],
    [
      "legacy edit with an empty OLD body",
      "/old/ * a.ts 'start:' 1\n\n// 'end:' 1\n\\new\\ * a.ts 'start:' 1\ny\n// 'end:' 1",
    ],
  ])("matches the original regex parser: %s", (_name, input) => {
    expect(parseChangeModeOutput(input)).toEqual(regexParseChangeModeOutput(input));
  });
});

describe("parseChangeModeOutput complexity", () => {
  // Each input is the attack string CodeQL reported for alerts 14-17, repeated far enough that
  // the old quadratic regexes took tens of seconds (about 22-41 ms at 8k characters, x4 per
  // doubling). A linear scan handles 200k characters in a few milliseconds.
  const size = 200_000;
  it.each([
    ["alerts 14/15: header followed by spaces", `**FILE:${" ".repeat(size)}`],
    ["alerts 14/15: OLD followed by newline-space runs", `**FILE:a:0**\n\`\`\`\nOLD:\n${"\n ".repeat(size / 2)}`],
    [
      "alerts 14/15: NEW followed by newline-space runs",
      `**FILE:a:0**\n\`\`\`\nOLD:\n\nNEW:\n${"\n ".repeat(size / 2)}`,
    ],
    ["alerts 16/17: repeated legacy headers", `/old/ * ${"/old/ * a".repeat(size / 9)}`],
    [
      "alerts 16/17: repeated legacy start tags",
      `/old/ * a 'start:' 0\n${"/old/ * a 'start:' 0\na".repeat(size / 22)}`,
    ],
    ["alerts 16/17: end tag followed by newlines", `/old/ * a 'start:' 0\n\n// 'end:' 0\n${"\n".repeat(size)}`],
    ["many headers on one line", "**FILE:".repeat(size / 7)],
    ["many markdown blocks without a NEW section", "**FILE:a:0**\n```\nOLD:\nx\n".repeat(size / 22)],
    ["many NEW sections without a closing fence", `**FILE:a:0**\n\`\`\`\nOLD:\n${"x\nNEW:\n".repeat(size / 7)}`],
  ])("parses %s in linear time", (_name, input) => {
    const started = performance.now();
    expect(parseChangeModeOutput(input)).toEqual([]);
    // Generous bound for slow CI runners; the regexes needed well over 10 seconds here.
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("validateChangeModeEdits", () => {
  it("returns valid for correct edits", () => {
    const result = validateChangeModeEdits([
      {
        filename: "test.ts",
        oldStartLine: 1,
        oldEndLine: 3,
        oldCode: "old code",
        newStartLine: 1,
        newEndLine: 3,
        newCode: "new code",
      },
    ]);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reports missing filename", () => {
    const result = validateChangeModeEdits([
      {
        filename: "",
        oldStartLine: 1,
        oldEndLine: 1,
        oldCode: "x",
        newStartLine: 1,
        newEndLine: 1,
        newCode: "y",
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Edit missing filename");
  });

  it("reports reversed old line range", () => {
    const result = validateChangeModeEdits([
      {
        filename: "test.ts",
        oldStartLine: 10,
        oldEndLine: 5,
        oldCode: "x",
        newStartLine: 1,
        newEndLine: 1,
        newCode: "y",
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Invalid line range");
  });

  it("reports reversed new line range", () => {
    const result = validateChangeModeEdits([
      {
        filename: "test.ts",
        oldStartLine: 1,
        oldEndLine: 1,
        oldCode: "x",
        newStartLine: 10,
        newEndLine: 5,
        newCode: "y",
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Invalid new line range");
  });

  it("reports both codes empty", () => {
    const result = validateChangeModeEdits([
      {
        filename: "test.ts",
        oldStartLine: 1,
        oldEndLine: 1,
        oldCode: "",
        newStartLine: 1,
        newEndLine: 1,
        newCode: "",
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Empty edit");
  });

  it("returns valid for empty edits array", () => {
    const result = validateChangeModeEdits([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("collects multiple errors", () => {
    const result = validateChangeModeEdits([
      {
        filename: "",
        oldStartLine: 10,
        oldEndLine: 5,
        oldCode: "",
        newStartLine: 1,
        newEndLine: 1,
        newCode: "",
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
