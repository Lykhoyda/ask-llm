import { describe, expect, it } from "vitest";
import { parseChangeModeOutput, validateChangeModeEdits } from "../changeModeParser.js";

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
