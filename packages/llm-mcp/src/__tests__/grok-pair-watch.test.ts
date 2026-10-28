import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adaptGrokPayload } from "../../scripts/lib/grok-payload.mjs";
import { resolveReviewer } from "../../scripts/lib/pair-reviewer.mjs";
import { addAck, hashConcernBody } from "../../scripts/lib/state.mjs";
import { PLUGIN_ROOT } from "./_helpers.js";

describe("Grok payload adapter", () => {
  it("maps file edits relative to the event cwd and preserves the session", () => {
    expect(
      adaptGrokPayload(
        {
          hook_event_name: "PostToolUse",
          tool_name: "search_replace",
          session_id: "session",
          cwd: "/project",
          tool_input: { file_path: "src/main.ts", old_string: "a", new_string: "b" },
        },
        "/elsewhere",
      ),
    ).toEqual({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      session_id: "session",
      tool_input: { file_path: "/project/src/main.ts" },
    });
  });

  it("preserves shell command bytes without executing or inferring a diff", () => {
    const command = "cat > x <<'EOF'\n$(danger)\nEOF\n";
    expect(
      adaptGrokPayload(
        {
          hook_event_name: "PostToolUse",
          tool_name: "run_terminal_command",
          tool_input: { command },
        },
        "/project",
      )?.tool_input,
    ).toEqual({ command, cwd: "/project" });
  });

  it.each([
    null,
    {},
    { hook_event_name: "PreToolUse" },
    {
      hook_event_name: "PostToolUse",
      tool_name: "read_file",
      tool_input: { file_path: "a" },
    },
    {
      hook_event_name: "PostToolUse",
      tool_name: "search_replace",
      tool_input: { file_path: 1 },
    },
  ])("ignores unsupported payloads %j", (payload) => {
    expect(adaptGrokPayload(payload, "/project")).toBeNull();
  });
});

describe("pair reviewer setting", () => {
  it("defaults to Codex and accepts Claude for a Grok writer", () => {
    expect(resolveReviewer(undefined, "grok")).toBe("codex");
    expect(resolveReviewer("claude", "grok")).toBe("claude");
  });

  it("refuses unknown reviewers and same-family review", () => {
    expect(() => resolveReviewer("grok", "grok")).toThrow("reviewer must be codex or claude");
    expect(() => resolveReviewer("claude", "claude")).toThrow("own model family's edits");
    expect(() => resolveReviewer("codex", "codex")).toThrow("own model family's edits");
  });
});

describe("Grok hook through the shared pair lifecycle", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "grok-pair-test-"));
    mkdirSync(join(root, "bin"));
    mkdirSync(join(root, "home"));
    mkdirSync(join(root, ".codex-pair"));
    writeFileSync(join(root, ".codex-pair/context.md"), "Project context");
    writeFileSync(join(root, "file.ts"), "export const x = 1;");
    for (const name of ["codex", "claude"]) {
      writeFileSync(
        join(root, "bin", name),
        `#!${process.execPath}
const fs = require('node:fs');
let prompt = '';
process.stdin.on('data', chunk => prompt += chunk);
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.CAPTURE, JSON.stringify({name: ${JSON.stringify(name)}, args: process.argv.slice(2), prompt}) + '\\n');
  if (process.env.REVIEW_FAIL === '1') { console.log(JSON.stringify({is_error:true, result:'review unavailable'})); return; }
  const result = JSON.stringify({verdict:'needs-attention', findings:[{severity:'high',title:'Review note',body:'Check the invariant',file:'file.ts',line_start:1}]});
  console.log(JSON.stringify(${JSON.stringify(name)} === 'codex' ? {type:'item.completed',item:{type:'agent_message',text:result}} : {subtype:'success',result}));
});
`,
        { mode: 0o755 },
      );
    }
    env = {
      ...process.env,
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      HOME: join(root, "home"),
      GROK_HOME: join(root, "home/.grok"),
      CAPTURE: join(root, "calls.jsonl"),
      CODEX_PAIR_DISABLED: "0",
      CODEX_PAIR_REVIEWER: "codex",
      CODEX_PAIR_HOST: "",
      CODEX_PAIR_FORCE_SYNC: "0",
      ASK_CODEX_BROKER: "0",
      ASK_CODEX_MODEL: "gpt-6.1-sol",
      ASK_CODEX_DEBOUNCE_MS: "15000",
      ASK_CODEX_TIMEOUT_MS: "2000",
      ASK_CLAUDE_TIMEOUT_MS: "2000",
    };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function run(tool = "search_replace", input: Record<string, unknown> = { file_path: "file.ts" }, claudeHost = false) {
    const result = spawnSync(
      process.execPath,
      [join(PLUGIN_ROOT, "scripts", claudeHost ? "codex-pair-watch.mjs" : "grok-pair-watch.mjs")],
      {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 10_000,
        input: JSON.stringify({ hook_event_name: "PostToolUse", cwd: root, tool_name: tool, tool_input: input }),
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    return result.stdout.trim() ? (JSON.parse(result.stdout).hookSpecificOutput.additionalContext as string) : "";
  }
  function calls() {
    return readFileSync(join(root, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  it("runs Codex Sol synchronously despite the default debounce and emits a next-step note", () => {
    expect(run()).toContain("Review note");
    const [call] = calls();
    expect(call.name).toBe("codex");
    expect(call.args).toEqual(expect.arrayContaining(["--sandbox", "read-only", "-m", "gpt-6.1-sol"]));
    expect(call.prompt).toContain("export const x = 1;");
    expect(run()).toContain("[cached]");
    expect(calls()).toHaveLength(1);
  });

  it("selects pinned Claude Opus with a hard read-tool boundary and a separate cache", () => {
    run();
    writeFileSync(join(root, ".codex-pair/context.md"), "---\nreviewer: claude\n---\nProject context");
    expect(run()).toContain("claude / claude-opus-5-5");
    const call = calls()[1];
    expect(call.name).toBe("claude");
    expect(call.args).toEqual(
      expect.arrayContaining(["--model", "claude-opus-5-5", "--safe-mode", "--tools", "Read,Glob,Grep"]),
    );
    expect(call.args).not.toContain("--fallback-model");
    expect(call.prompt).toContain("export const x = 1;");
  });

  it("honors the environment reviewer setting", () => {
    env.CODEX_PAIR_REVIEWER = "claude";
    expect(run()).toContain("claude-opus-5-5");
    expect(calls()[0].name).toBe("claude");
  });

  it("reviews command text without reading a synthetic file or running the command", () => {
    const command = "printf unsafe > never-executed.txt";
    expect(run("run_terminal_command", { command })).toContain("Review note");
    expect(calls()[0].prompt).toContain(command);
    expect(calls()[0].prompt).toContain("not a file or diff");
    expect(() => readFileSync(join(root, "never-executed.txt"))).toThrow();
    const log = readFileSync(join(root, ".codex-pair/log.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(log.at(-1).coverage).toBe("command-text");
  });

  it("uses shared pause/resume state and acknowledgement suppression", () => {
    mkdirSync(join(root, ".codex-pair/state"));
    writeFileSync(join(root, ".codex-pair/state/paused"), "");
    expect(run()).toBe("");
    expect(() => calls()).toThrow();
    rmSync(join(root, ".codex-pair/state/paused"));
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(root, "file.ts"), `export const x = ${i};`);
      const note = run();
      if (i === 2) expect(note).toContain("REPEATED-IGNORED");
    }
    const log = readFileSync(join(root, ".codex-pair/log.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const body = log.at(-1).concerns.high[0];
    addAck(root, hashConcernBody(`file.ts:${body}`), { reason: "accepted for this fixture" });
    writeFileSync(join(root, "file.ts"), "export const x = 4;");
    expect(run()).not.toContain("REPEATED-IGNORED");
  });

  it("refuses Claude reviewing Claude before any reviewer process starts", () => {
    env.CODEX_PAIR_REVIEWER = "claude";
    expect(run("Edit", { file_path: join(root, "file.ts") }, true)).toContain("own model family's edits");
    expect(() => calls()).toThrow();
  });

  it("refuses invalid reviewers without falling back to Codex", () => {
    env.CODEX_PAIR_REVIEWER = "unknown";
    expect(run()).toContain("reviewer must be codex or claude");
    expect(() => calls()).toThrow();
  });

  it("reports Claude structured failures rather than a clean review", () => {
    env.CODEX_PAIR_REVIEWER = "claude";
    env.REVIEW_FAIL = "1";
    expect(run()).toContain("review failed: review unavailable");
  });
});
