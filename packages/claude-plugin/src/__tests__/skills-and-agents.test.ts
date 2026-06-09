import { describe, expect, it } from "vitest";
import { listFiles, listSubdirs, parseMarkdownFrontmatter, readFile } from "./_helpers.js";

const expectedSkills = [
  "antigravity-review",
  "brainstorm",
  "brainstorm-all",
  "codex-image",
  "codex-pair",
  "codex-pair-ack",
  "codex-pair-pause",
  "codex-pair-resume",
  "codex-review",
  "codex-verify",
  "compare",
  "gemini-review",
  "multi-review",
  "ollama-review",
];
const expectedAgents = [
  "antigravity-reviewer.md",
  "brainstorm-coordinator.md",
  "codex-reviewer.md",
  "codex-verifier.md",
  "gemini-reviewer.md",
  "ollama-reviewer.md",
];

describe("skills/", () => {
  it("contains the expected set of skill directories", () => {
    const dirs = listSubdirs("skills").sort();
    expect(dirs).toEqual(expectedSkills.sort());
  });

  it.each(expectedSkills)("%s skill has SKILL.md with required frontmatter", (skillName) => {
    const content = readFile(`skills/${skillName}/SKILL.md`);
    const { frontmatter, body } = parseMarkdownFrontmatter(content);

    expect(frontmatter.name).toBe(skillName);
    expect(frontmatter.description).toBeTruthy();
    expect(typeof frontmatter.description).toBe("string");
    expect((frontmatter.description as string).length).toBeGreaterThan(20);
    expect(body.trim().length).toBeGreaterThan(0);
  });

  it.each(expectedSkills)("%s skill description includes triggering language", (skillName) => {
    const content = readFile(`skills/${skillName}/SKILL.md`);
    const { frontmatter } = parseMarkdownFrontmatter(content);
    const desc = frontmatter.description as string;
    expect(desc).toMatch(/should be used|when the user|asks to|wants to|review|brainstorm/i);
  });

  it("user_invocable skills are clearly marked", () => {
    for (const skill of expectedSkills) {
      const { frontmatter } = parseMarkdownFrontmatter(readFile(`skills/${skill}/SKILL.md`));
      if (frontmatter.user_invocable !== undefined) {
        expect(["true", "false"]).toContain(String(frontmatter.user_invocable));
      }
    }
  });
});

describe("agents/", () => {
  it("contains the expected set of agent files", () => {
    const files = listFiles("agents", ".md").sort();
    expect(files).toEqual(expectedAgents.sort());
  });

  it.each(expectedAgents)("%s has required frontmatter fields", (agentFile) => {
    const content = readFile(`agents/${agentFile}`);
    const { frontmatter, body } = parseMarkdownFrontmatter(content);

    expect(frontmatter.name).toBeTruthy();
    expect(frontmatter.description).toBeTruthy();
    expect((frontmatter.description as string).length).toBeGreaterThan(40);
    expect(body.trim().length).toBeGreaterThan(100);
  });

  it.each(expectedAgents)("%s declares a model and color", (agentFile) => {
    const { frontmatter } = parseMarkdownFrontmatter(readFile(`agents/${agentFile}`));
    expect(frontmatter.model).toBeTruthy();
    expect(frontmatter.color).toBeTruthy();
  });

  it("each reviewer agent has its provider's MCP tool in the tools list", () => {
    const cases: Array<{ file: string; tool: string }> = [
      { file: "gemini-reviewer.md", tool: "mcp__gemini__ask-gemini" },
      { file: "codex-reviewer.md", tool: "mcp__codex__ask-codex" },
      { file: "ollama-reviewer.md", tool: "mcp__ollama__ask-ollama" },
      { file: "antigravity-reviewer.md", tool: "mcp__antigravity__ask-antigravity" },
    ];
    for (const { file, tool } of cases) {
      const { frontmatter } = parseMarkdownFrontmatter(readFile(`agents/${file}`));
      const tools = frontmatter.tools;
      expect(Array.isArray(tools)).toBe(true);
      expect(tools as string[]).toContain(tool);
    }
  });

  it("review agents are restricted from edit/write tools", () => {
    const reviewerAgents = ["gemini-reviewer.md", "codex-reviewer.md", "ollama-reviewer.md", "antigravity-reviewer.md"];
    for (const file of reviewerAgents) {
      const { frontmatter } = parseMarkdownFrontmatter(readFile(`agents/${file}`));
      const tools = frontmatter.tools as string[] | undefined;
      if (!tools) continue;
      expect(tools).not.toContain("Edit");
      expect(tools).not.toContain("Write");
      expect(tools).not.toContain("NotebookEdit");
    }
  });
});

describe("multi-review skill — load-bearing polish (ADR-064)", () => {
  const content = readFile("skills/multi-review/SKILL.md");
  const { body } = parseMarkdownFrontmatter(content);

  it("documents diff preprocessing (intent-to-add for new files)", () => {
    expect(body).toMatch(/git add -N/);
  });

  it("documents pathspec exclusion of docs and binaries", () => {
    expect(body).toMatch(/!docs\//);
    expect(body).toMatch(/!\*\.md/);
  });

  it("specifies size-check tiers (50KB / 150KB)", () => {
    expect(body).toMatch(/50.{0,5}KB/);
    expect(body).toMatch(/150.{0,5}KB/);
  });

  it("requires a per-finding verification step before presenting", () => {
    expect(body).toMatch(/[Vv]erif/);
    expect(body).toMatch(/Read.{0,30}file/);
  });

  it("classifies findings as VERIFIED / REJECTED / UNVERIFIABLE", () => {
    expect(body).toMatch(/VERIFIED/);
    expect(body).toMatch(/REJECTED/);
    expect(body).toMatch(/UNVERIFIABLE/);
  });

  it("documents fallback dispatch via dist runner binaries", () => {
    expect(body).toMatch(/dist\/antigravity-run\.js/);
    expect(body).toMatch(/dist\/codex-run\.js/);
  });

  it("includes the ADR-050 dispatch pattern (direct backgrounding + per-PID wait)", () => {
    expect(body).toMatch(/&\s*\nagy_pid=\$!|& agy_pid=\$!/);
    expect(body).toMatch(/wait \$agy_pid|wait "\$agy_pid"/);
  });

  it("forbids raw provider CLI invocation (preserves quota fallback + stdin handling)", () => {
    expect(body).toMatch(/[Dd]o NOT use raw|bypass.{0,40}quota fallback/);
  });

  it("requires resilient failure handling (don't silently drop a failed provider)", () => {
    expect(body).toMatch(/[Dd]o NOT silently drop|silently drop|surface the failure/i);
  });

  it("requires a Context Brief before dispatching reviewer prompts", () => {
    expect(body).toMatch(/Context Brief/);
    expect(body).toMatch(/Providers: <list the actual providers selected for this run>/);
    expect(body).toMatch(/Included files\/docs/);
    expect(body).toMatch(/Excluded files\/docs and reason/);
    expect(body).toMatch(/Diff bytes/);
    expect(body).toMatch(/before the diff/);
  });

  it("pins the Context used section in the output template", () => {
    expect(body).toMatch(/Context used:/);
    expect(body).toMatch(/Included: <files \/ packages>/);
    expect(body).toMatch(/Excluded: <files \/ patterns and reason>/);
    expect(body).toMatch(/Diff bytes: <N>/);
  });
});

describe("brainstorm skill — polish (ADR-064)", () => {
  const content = readFile("skills/brainstorm/SKILL.md");
  const { body } = parseMarkdownFrontmatter(content);

  it("documents diff preprocessing for code-context brainstorms", () => {
    expect(body).toMatch(/git add -N/);
    expect(body).toMatch(/!docs\//);
  });

  it("warns about diff size (>150KB threshold)", () => {
    expect(body).toMatch(/150.{0,5}KB/);
  });

  it("notes that confidence scores are not an oracle", () => {
    expect(body).toMatch(/[Cc]onfidence scores are not an oracle/);
  });

  it("points users to /multi-review for source-verified code review", () => {
    expect(body).toMatch(/\/multi-review/);
  });

  it("requires passing a Context Brief into the coordinator", () => {
    expect(body).toMatch(/Context Brief/);
    expect(body).toMatch(/Providers: <list the selected providers for this run>/);
    expect(body).toMatch(/Included files\/docs/);
    expect(body).toMatch(/Excluded files\/docs and reason/);
    expect(body).toMatch(/unverified assumptions/);
  });
});

describe("brainstorm-coordinator agent — Phase 4 cross-check polish (ADR-064)", () => {
  const content = readFile("agents/brainstorm-coordinator.md");
  const { body } = parseMarkdownFrontmatter(content);

  it("documents the cross-check step before promoting external findings", () => {
    expect(body).toMatch(/[Cc]ross-check/);
  });

  it("classifies findings as Verified / Rejected / Unverifiable in synthesis", () => {
    expect(body).toMatch(/Verified.*Rejected.*Unverifiable/s);
  });

  it("includes a Rejected section in the synthesis to surface false positives", () => {
    expect(body).toMatch(/Rejected.*false positives/i);
  });

  it("requires the coordinator to update the Context Brief after Claude research", () => {
    expect(body).toMatch(/Context Brief/);
    expect(body).toMatch(/verified files\/docs|files\/docs you verified/i);
    expect(body).toMatch(/assumptions remain unverified|unverified assumptions/i);
    expect(body).toMatch(/before external dispatch|before dispatch/i);
  });
});

describe("compare skill — load-bearing structure", () => {
  const content = readFile("skills/compare/SKILL.md");
  const { frontmatter, body } = parseMarkdownFrontmatter(content);

  it("is user-invocable", () => {
    expect(String(frontmatter.user_invocable)).toBe("true");
  });

  it("description differentiates from /brainstorm and /multi-review", () => {
    const desc = frontmatter.description as string;
    expect(desc).toMatch(/side-by-side|verbatim|raw responses|without synthesis/i);
  });

  it("documents the ADR-050 dispatch pattern (direct backgrounding + per-PID wait)", () => {
    expect(body).toMatch(/&\s*pid=\$!|& gem_pid=\$!/);
    expect(body).toMatch(/wait \$/);
  });

  it("warns against the sub-agent background-job anti-patterns", () => {
    expect(body).toMatch(/run_in_background.*true/);
    expect(body).toMatch(/cmd\s*&\s*\)/);
    expect(body).toMatch(/SIGKILL|silently/i);
  });

  it("requires a 10-minute Bash timeout on the dispatch call", () => {
    expect(body).toMatch(/600000|10[\s-]minute/);
  });

  it("explicitly rejects synthesis (the differentiator from /brainstorm)", () => {
    expect(body).toMatch(/verbatim|do NOT paraphrase|do not adjudicate|stay neutral/i);
  });

  it("uses the dist/ runner binaries (not raw provider CLIs)", () => {
    expect(body).toMatch(/dist\/run\.js/);
    expect(body).toMatch(/dist\/codex-run\.js/);
    expect(body).toMatch(/dist\/ollama-run\.js/);
  });
});

describe("brainstorm-coordinator agent", () => {
  const content = readFile("agents/brainstorm-coordinator.md");
  const { frontmatter, body } = parseMarkdownFrontmatter(content);

  it("runs on opus (model is the strongest available)", () => {
    expect(frontmatter.model).toBe("opus");
  });

  it("has all four external provider MCP tools", () => {
    const tools = frontmatter.tools as string[];
    expect(tools).toContain("mcp__gemini__ask-gemini");
    expect(tools).toContain("mcp__codex__ask-codex");
    expect(tools).toContain("mcp__ollama__ask-ollama");
    expect(tools).toContain("mcp__antigravity__ask-antigravity");
  });

  it("has WebFetch and WebSearch (Phase 3B research surface — ADR-049)", () => {
    const tools = frontmatter.tools as string[];
    expect(tools).toContain("WebFetch");
    expect(tools).toContain("WebSearch");
  });

  it("documents the sub-agent background-job lifecycle constraint (ADR-050)", () => {
    expect(body).toMatch(/background.{0,30}job/i);
    expect(body).toMatch(/sub-agent|subagent/i);
  });

  it("requires Phase 3B (Claude research) to run before Phase 3A (external dispatch) — ADR-049", () => {
    expect(body).toMatch(/Phase 3B/);
    expect(body).toMatch(/Phase 3A/);
    expect(body).toMatch(/sequential|before|first/i);
  });

  it("warns against the (cmd &) subshell anti-pattern from ADR-050", () => {
    expect(body).toMatch(/blocking|foreground|wait/i);
  });
});

describe("codex-verifier agent — claim verification contract (ADR-073)", () => {
  const content = readFile("agents/codex-verifier.md");
  const { frontmatter, body } = parseMarkdownFrontmatter(content);

  it("declares mcp__codex__ask-codex in tools (so Codex can be dispatched for narrow per-claim checks)", () => {
    const tools = frontmatter.tools as string[];
    expect(tools).toContain("mcp__codex__ask-codex");
  });

  it("is restricted from Write / Edit / NotebookEdit (read-only tool surface — Pi verifier pattern)", () => {
    const tools = frontmatter.tools as string[];
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Write");
    expect(tools).not.toContain("NotebookEdit");
  });

  it("description differentiates from codex-reviewer (issue hunt vs trust verification)", () => {
    const desc = frontmatter.description as string;
    expect(desc).toMatch(/[Dd]istinct from `?codex-reviewer/);
  });

  it("documents the five-grade CONFIDENCE ladder", () => {
    expect(body).toMatch(/PERFECT/);
    expect(body).toMatch(/VERIFIED/);
    expect(body).toMatch(/PARTIAL/);
    expect(body).toMatch(/FEEDBACK/);
    expect(body).toMatch(/FAILED/);
  });

  it("encodes the 'evidence beats assertion' core principle (no evidence → unsure, not verified)", () => {
    expect(body).toMatch(/[Ww]ithout evidence.*unsure/);
  });

  it("requires atomic claim decomposition (Pi verifier's central pattern)", () => {
    expect(body).toMatch(/[Aa]tomic claim/);
    expect(body).toMatch(/[Dd]ecomposition|decomposes/);
  });

  it("forbids fix proposals (verifier is structurally narrowed)", () => {
    expect(body).toMatch(/[Nn]o fix proposals/);
  });

  it("forbids issue hunting (out-of-scope bugs do not go in the Report)", () => {
    expect(body).toMatch(/[Nn]o issue hunting|[Oo]ut-of-scope bugs/);
  });

  it("specifies the Report block contract with STATUS and CONFIDENCE lines", () => {
    expect(body).toMatch(/## Report/);
    expect(body).toMatch(/STATUS:/);
    expect(body).toMatch(/CONFIDENCE:/);
  });
});

describe("/codex-verify skill — load-bearing structure (ADR-073)", () => {
  const content = readFile("skills/codex-verify/SKILL.md");
  const { frontmatter, body } = parseMarkdownFrontmatter(content);

  it("is user-invocable", () => {
    expect(String(frontmatter.user_invocable)).toBe("true");
  });

  it("description distinguishes from /codex-review (issue hunt vs trust check)", () => {
    const desc = frontmatter.description as string;
    expect(desc).toMatch(/[Dd]ifferent from `?\/codex-review|distinct.*codex-review/i);
  });

  it("dispatches the codex-verifier agent (not codex-reviewer)", () => {
    expect(body).toMatch(/codex-verifier/);
    expect(body).not.toMatch(/[Ll]aunch.*codex-reviewer.*agent/);
  });

  it("captures the assistant's last message verbatim as the source of claims", () => {
    expect(body).toMatch(/[Aa]ssistant'?s last message/);
    expect(body).toMatch(/verbatim/);
  });

  it("documents the defensive parser fallback (CONFIDENCE derived from STATUS when missing)", () => {
    expect(body).toMatch(/verified.{0,10}→.{0,10}VERIFIED/);
    expect(body).toMatch(/failed.{0,10}→.{0,10}FEEDBACK/);
    expect(body).toMatch(/unsure.{0,10}→.{0,10}FAILED/);
  });

  it("treats PARTIAL as a real verdict, not a softer VERIFIED", () => {
    expect(body).toMatch(/PARTIAL is a real verdict|PARTIAL is the most actionable/);
  });

  it("requires presenting the Report's five sections", () => {
    expect(body).toMatch(/[Vv]erified/);
    expect(body).toMatch(/[Ff]ailed/);
    expect(body).toMatch(/[Uu]nverifiable/);
    expect(body).toMatch(/[Cc]orrective feedback/);
  });
});

describe("multi-review skill — claim-vs-finding redirect (ADR-073)", () => {
  const content = readFile("skills/multi-review/SKILL.md");
  const { body } = parseMarkdownFrontmatter(content);

  it("points users at /codex-verify when they want claim verification rather than finding verification", () => {
    expect(body).toMatch(/\/codex-verify/);
  });

  it("explains the two-kinds-of-verification distinction", () => {
    expect(body).toMatch(
      /[Tt]wo kinds of verification|review findings.{0,200}assistant claims|assistant claims.{0,200}review findings/s,
    );
  });
});

describe("brainstorm-coordinator — synthesis-confidence ladder (ADR-073 follow-on)", () => {
  const content = readFile("agents/brainstorm-coordinator.md");
  const { body } = parseMarkdownFrontmatter(content);

  it("documents a four-grade synthesis-confidence ladder", () => {
    expect(body).toMatch(/PERFECT/);
    expect(body).toMatch(/VERIFIED/);
    expect(body).toMatch(/PARTIAL/);
    expect(body).toMatch(/FAILED/);
  });

  it("explicitly drops FEEDBACK from the codex-verify ladder (no fix-loop semantic in brainstorming)", () => {
    expect(body).toMatch(/FEEDBACK.{0,200}(dropped|not apply|doesn'?t apply|intentionally dropped)/i);
  });

  it("ties the ladder back to /codex-verify so the lineage is documented", () => {
    expect(body).toMatch(/\/codex-verify|codex-verify confidence ladder/);
  });

  it("requires the synthesis-confidence grade as the first line of the output", () => {
    expect(body).toMatch(/Synthesis confidence:.{0,200}\[PERFECT \| VERIFIED \| PARTIAL \| FAILED\]/);
  });

  it("warns that false PERFECT is worse than honest PARTIAL (porting Pi's honesty discipline)", () => {
    expect(body).toMatch(/false `?PERFECT`? is worse than honest `?PARTIAL`?/i);
  });
});

describe("agents/ — no removed codex CLI flags (#37/#38/#52)", () => {
  // codex rust-v0.128+ removed `--full-auto` entirely; on codex 0.135 it errors
  // with "unexpected argument", so any agent still spawning it has a broken codex
  // dispatch. The canonical replacement is `--sandbox workspace-write`.
  it.each(expectedAgents)("%s does not invoke the removed `codex exec --full-auto` flag", (agentFile) => {
    expect(readFile(`agents/${agentFile}`)).not.toMatch(/--full-auto/);
  });

  it("brainstorm-coordinator dispatches codex with `--sandbox workspace-write`", () => {
    expect(readFile("agents/brainstorm-coordinator.md")).toMatch(/codex exec --sandbox workspace-write/);
  });
});
