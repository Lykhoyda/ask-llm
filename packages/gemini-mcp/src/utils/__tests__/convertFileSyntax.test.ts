import { describe, expect, it } from "vitest";
import { convertFileSyntaxToAt } from "../geminiExecutor.js";

describe("convertFileSyntaxToAt", () => {
  it("converts a standalone file: token to @ syntax", () => {
    expect(convertFileSyntaxToAt("review file:src/index.ts please")).toBe("review @src/index.ts please");
  });

  it("converts a file: token at the very start of the prompt", () => {
    expect(convertFileSyntaxToAt("file:a.ts and file:b.ts")).toBe("@a.ts and @b.ts");
  });

  it("does NOT mangle words that merely contain 'file:' as a substring", () => {
    // Regression: the unanchored /file:(\S+)/ turned "profile:default" into
    // "pro@default" and "Makefile:42" into "Make@42".
    expect(convertFileSyntaxToAt("refactor the profile:default handler")).toBe("refactor the profile:default handler");
    expect(convertFileSyntaxToAt("update Makefile:42 now")).toBe("update Makefile:42 now");
  });

  it("does NOT corrupt file:// URLs", () => {
    expect(convertFileSyntaxToAt("see file:///etc/hosts for details")).toBe("see file:///etc/hosts for details");
  });

  it("leaves prompts without file: tokens unchanged", () => {
    expect(convertFileSyntaxToAt("just some normal text")).toBe("just some normal text");
  });
});
