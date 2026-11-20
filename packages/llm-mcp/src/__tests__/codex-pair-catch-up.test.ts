import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { bumpEditRecord, readEditRecord, markReviewed, contentHash } from "../../scripts/lib/debounce-state.mjs";
import { inflightLockPath, releaseInflightLock, pausePath, tryAcquireInflightLock } from "../../scripts/lib/state.mjs";
import { PLUGIN_ROOT } from "./_helpers.js";

const SESSION = "catch-up-test";
const LOG = "codex-pair-log.mjs";
const STOP = "codex-pair-stop-gate.mjs";
const SESSION_HOOK = "codex-pair-session.mjs";
const WATCH = "codex-pair-watch.mjs";

let scratch: string;
let repo: string;
let calls: string;
let released: string;
let started: string;

function git(cwd: string, ...args: string[]) {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function initRepo(name: string) {
  const root = join(scratch, name);
  mkdirSync(root);
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Pair Test");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, ".gitignore"), "/.codex-pair/\n*.ignored.ts\n");
  for (const file of ["tracked.ts", "deleted.ts"]) writeFileSync(join(root, file), "export const before = true;\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "Initial files");
  return root;
}

function marker(frontmatter = "", root = repo, body = "# Test project") {
  mkdirSync(join(root, ".codex-pair"), { recursive: true });
  writeFileSync(join(root, ".codex-pair", "context.md"), `---\n${frontmatter}\n---\n${body}\n`);
}

function shellWrite(file: string, text = "// REVIEW_TOKEN_shell\n", root = repo) {
  execFileSync("sh", ["-c", 'printf "%s" "$2" > "$1"', "fixture", join(root, file), text]);
}

function run(
  script: string,
  { args = [] as string[], event = {}, cwd = repo, scenario = "none", env = {} as NodeJS.ProcessEnv } = {},
) {
  const result = spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", script), ...args], {
    cwd,
    input: JSON.stringify({ session_id: SESSION, ...event }),
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      PATH: `${join(PLUGIN_ROOT, "src", "__tests__", "_fixtures")}:${process.env.PATH}`,
      CLAUDE_CODE_SESSION_ID: SESSION,
      CODEX_PAIR_SESSION_REGISTRY_ROOT: scratch,
      CLAUDE_CONFIG_DIR: join(scratch, "claude"),
      CODEX_PAIR_DISABLED: "0",
      CODEX_PAIR_FORCE_SYNC: "",
      CODEX_PAIR_HOST: "",
      ASK_CODEX_BROKER: "0",
      ASK_CODEX_DEBOUNCE_MS: "25",
      FAKE_CODEX_SCENARIO: scenario,
      FAKE_CODEX_ARGS_FILE: calls,
      FAKE_CODEX_STARTED_FILE: started,
      FAKE_CODEX_RELEASE_FILE: released,
      ...env,
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout;
}

function report() {
  return JSON.parse(run(LOG, { args: ["--report", "--json"] })).unreviewedFiles;
}

function logPath(root = repo) {
  return join(root, ".codex-pair", "log.jsonl");
}

function log(root = repo) {
  const file = logPath(root);
  return existsSync(file)
    ? readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

function receivedCalls() {
  return existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0;
}

function stop(scenario = "none") {
  return run(STOP, { event: { hook_event_name: "Stop" }, scenario });
}

function edit(path: string, cwd = repo) {
  return run(WATCH, {
    cwd,
    event: { hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(cwd, path) } },
  });
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "codex-pair-catch-up-")));
  repo = initRepo("main");
  calls = join(scratch, "review-calls");
  released = join(scratch, "release");
  started = join(scratch, "started");
});

afterEach(() => {
  writeFileSync(released, "");
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
});

it("reviews edits made before activation, after a shell write at turn end and during a manual pause", async () => {
  shellWrite("tracked.ts");
  marker();

  expect(run(LOG, { args: ["start"] })).toContain("active");
  await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);
  expect(log()).toContainEqual(
    expect.objectContaining({ file: join(repo, "tracked.ts"), verdict: "none", source: "catch-up" }),
  );

  shellWrite("turn.ts");
  stop();
  await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);

  run(LOG, { args: ["pause"] });
  shellWrite("paused.ts");
  stop();
  expect(report()).toEqual([{ repository: repo, file: "paused.ts", status: "not-started" }]);
  expect(receivedCalls()).toBe(2);

  run(LOG, { args: ["resume"] });
  await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);
  expect(receivedCalls()).toBe(3);
});

it("runs catch-up for dirty content that only has a Pi success row", async () => {
  marker();
  shellWrite("tracked.ts");
  const file = join(repo, "tracked.ts");
  writeFileSync(
    logPath(),
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      file,
      contentHash: contentHash(readFileSync(file, "utf8")),
      reviewer: "codex",
      model: "gpt-6.2-sol",
      reasoningEffort: "high",
      source: "pi",
      verdict: "none",
    })}\n`,
  );
  expect(report()).toEqual([{ repository: repo, file: "tracked.ts", status: "not-started" }]);
  stop();
  await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);
  expect(receivedCalls()).toBe(1);
  expect(log()).toContainEqual(expect.objectContaining({ source: "catch-up", verdict: "none" }));
});

it.each(["SessionStart", "PostToolUse"])("catches up on automatic resume from %s", async (trigger) => {
  marker();
  mkdirSync(join(repo, ".codex-pair", "state"), { recursive: true });
  writeFileSync(
    pausePath(repo),
    JSON.stringify({
      v: 1,
      kind: "quota",
      reason: "usage limit",
      at: new Date(Date.now() - 48 * 3_600_000).toISOString(),
    }),
  );
  shellWrite("during-pause.ts");

  if (trigger === "SessionStart") run(SESSION_HOOK, { event: { hook_event_name: trigger } });
  else {
    shellWrite("next-edit.ts");
    edit("next-edit.ts");
  }
  await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);
  expect(log()).toContainEqual(expect.objectContaining({ verdict: "auto_resumed" }));
  expect(log()).toContainEqual(
    expect.objectContaining({ file: join(repo, "during-pause.ts"), verdict: "none", source: "catch-up" }),
  );
});

it("uses successful retained content hashes even after the cache expires and retries failed attempts", async () => {
  marker("model: gpt-6.2-sol\nreasoningEffort: high\nblockOn: HIGH");
  shellWrite("tracked.ts");
  const old = new Date(Date.now() - 11 * 60_000);
  const context = join(repo, ".codex-pair", "context.md");
  utimesSync(context, old, old);
  const file = join(repo, "tracked.ts");
  const hash = contentHash(readFileSync(file, "utf8"));
  const recorded = {
    timestamp: new Date(old.getTime() + 1000).toISOString(),
    file,
    contentHash: hash,
    reviewer: "codex",
    model: "gpt-6.2-sol",
    reasoningEffort: "high",
  };
  writeFileSync(logPath(), `${JSON.stringify({ ...recorded, verdict: "none" })}\n`);
  expect(stop("exit-nonzero")).toBe("");
  expect(report()).toEqual([]);
  expect(receivedCalls()).toBe(0);

  // Losing the successful row makes the same content eligible again.
  writeFileSync(logPath(), `${JSON.stringify({ ...recorded, verdict: "retried" })}\n`);
  stop("parse-failed");
  await expect
    .poll(() => report(), { timeout: 5000 })
    .toEqual([{ repository: repo, file: "tracked.ts", status: "failed" }]);

  stop();
  await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);
  expect(receivedCalls()).toBe(2);

  marker("model: gpt-6.2-sol\nreasoningEffort: high", repo, "# Revised instructions");
  expect(report()).toEqual([{ repository: repo, file: "tracked.ts", status: "not-started" }]);
  stop();
  await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);

  marker("model: other-model\nreasoningEffort: high", repo, "# Revised instructions");
  expect(report()).toEqual([{ repository: repo, file: "tracked.ts", status: "not-started" }]);
  stop();
  await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);
  expect(receivedCalls()).toBe(4);
});

it("returns from Stop while the first review runs and hands a concurrent edit to the existing debounce worker", async () => {
  marker("blockOn: HIGH");
  shellWrite("tracked.ts", "// REVIEW_TOKEN_old\n");
  const gate = JSON.parse(stop("gated"));
  expect(gate).toMatchObject({ decision: "block", reason: expect.stringContaining("still in flight") });
  await expect.poll(() => existsSync(started), { timeout: 5000 }).toBe(true);
  expect(report()).toEqual([{ repository: repo, file: "tracked.ts", status: "pending" }]);

  shellWrite("tracked.ts", "// REVIEW_TOKEN_current\n");
  edit("tracked.ts");
  expect(report()).toEqual([{ repository: repo, file: "tracked.ts", status: "pending" }]);
  expect(receivedCalls()).toBe(1);

  writeFileSync(released, "");
  await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);
  expect(log()).toContainEqual(
    expect.objectContaining({ contentHash: contentHash("// REVIEW_TOKEN_current\n"), verdict: "none" }),
  );
  const drained = run("codex-pair-prompt-drain.mjs", { event: { hook_event_name: "UserPromptSubmit" } });
  expect(drained).toContain("tracked.ts");
  expect(drained).not.toContain("REVIEW_TOKEN_old");
});

it("stops at quota exhaustion and names the failed file and the files never started", async () => {
  marker();
  shellWrite("a.ts");
  shellWrite("b.ts");
  shellWrite("c.ts");
  stop("quota");

  await expect
    .poll(() => report(), { timeout: 5000 })
    .toEqual([
      { repository: repo, file: "a.ts", status: "failed" },
      { repository: repo, file: "b.ts", status: "not-started" },
      { repository: repo, file: "c.ts", status: "not-started" },
    ]);
  expect(existsSync(pausePath(repo))).toBe(true);
  expect(receivedCalls()).toBe(2); // One primary and one fallback, both for a.ts.
});

it("leaves the remaining files named when one review consumes the pass budget", () => {
  marker();
  shellWrite("a.ts");
  shellWrite("b.ts");
  const targets = ["a.ts", "b.ts"].map((name) => ({ markerDir: repo, file: join(repo, name), timeoutMs: 800_000 }));
  const lock = tryAcquireInflightLock(repo, targets[0].file, 60_000);
  expect(lock.acquired).toBe(true);
  run("codex-pair-debounce-worker.mjs", {
    scenario: "gated",
    env: {
      CP_CATCH_UP_PASS: JSON.stringify({
        targets,
        activeMarkers: [repo],
        firstLock: lock.lockPath,
        deadline: Date.now() + 2000,
      }),
    },
  });
  expect(report()).toEqual([
    { repository: repo, file: "a.ts", status: "failed" },
    { repository: repo, file: "b.ts", status: "not-started" },
  ]);
  expect(receivedCalls()).toBe(1);
}, 8000);

it("uses one ten-file bound across known repositories and excludes ignored, deleted, committed and unknown paths", async () => {
  const sibling = initRepo("registered");
  const unknown = initRepo("unregistered");
  for (const root of [repo, sibling, unknown]) {
    marker("", root);
    writeFileSync(join(root, ".codex-pair", "ignore"), "skip.ts\n");
  }
  shellWrite("skip.ts", undefined, sibling);
  edit("skip.ts", sibling); // A watched edit registers the repo before applying ignore.
  shellWrite("skip.ts");
  shellWrite("git.ignored.ts");
  unlinkSync(join(repo, "deleted.ts"));
  shellWrite("committed.ts");
  git(repo, "add", "committed.ts");
  git(repo, "commit", "-qm", "Committed shell write");
  shellWrite("alone.ts", undefined, unknown);
  for (let i = 0; i < 9; i++) shellWrite(`main-${i}.ts`);
  for (let i = 0; i < 3; i++) shellWrite(`sibling-${i}.ts`, undefined, sibling);

  stop();
  await expect
    .poll(() => report(), { timeout: 5000 })
    .toEqual([
      { repository: sibling, file: "sibling-1.ts", status: "not-started" },
      { repository: sibling, file: "sibling-2.ts", status: "not-started" },
    ]);
  expect(receivedCalls()).toBe(10);
  expect(run(LOG, { args: ["--report"] })).toContain(
    `Review not started ${JSON.stringify(join(sibling, "sibling-2.ts"))}`,
  );
  expect(log(unknown)).toEqual([]);
  expect([...log(), ...log(sibling)].filter((entry) => entry.source === "catch-up")).toHaveLength(10);
});

it("allows the marker to disable turn-end catch-up while leaving activation enabled", async () => {
  marker("catchUpOnStop: false");
  shellWrite("tracked.ts");
  expect(stop()).toBe("");
  expect(report()).toEqual([{ repository: repo, file: "tracked.ts", status: "not-started" }]);
  expect(receivedCalls()).toBe(0);

  run(LOG, { args: ["start"] });
  await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);
  expect(receivedCalls()).toBe(1);
});

it.each([true, false])(
  "a watched edit and catch-up share the lock across path aliases (watch uses alias: %s)",
  async (watchAlias) => {
    marker("debounceMs: 25");
    shellWrite("tracked.ts");
    const alias = join(scratch, "alias");
    symlinkSync(repo, alias, "dir");
    const watchRoot = watchAlias ? alias : repo;
    const catchUpRoot = watchAlias ? repo : alias;
    run(WATCH, {
      cwd: watchRoot,
      scenario: "gated",
      event: { tool_name: "Edit", tool_input: { file_path: join(watchRoot, "tracked.ts") } },
    });
    await expect.poll(() => existsSync(started), { timeout: 5000 }).toBe(true);
    expect(report()).toEqual([{ repository: repo, file: "tracked.ts", status: "pending" }]);
    run(LOG, { cwd: catchUpRoot, args: ["start"], scenario: "gated" });
    expect(receivedCalls()).toBe(1);
    expect(realpathSync(inflightLockPath(repo, join(repo, "tracked.ts")))).toBe(
      realpathSync(inflightLockPath(alias, join(alias, "tracked.ts"))),
    );
    shellWrite("tracked.ts", "// REVIEW_TOKEN_latest\n");
    edit("tracked.ts", catchUpRoot);
    writeFileSync(released, "");
    await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);
    expect(log().filter((entry) => entry.verdict === "none" || entry.verdict === "concerns")).toHaveLength(2);
    expect(receivedCalls()).toBe(2);
  },
);

it("canonical debounce keys preserve legacy alias generations and completed state", () => {
  marker();
  const alias = join(scratch, "alias");
  symlinkSync(repo, alias, "dir");
  const file = join(repo, "tracked.ts");
  const legacyFile = join(alias, "tracked.ts");
  const legacyKey = createHash("sha256").update(legacyFile).digest("hex").slice(0, 16);
  const state = join(repo, ".codex-pair/state");
  for (const directory of ["debounce", "reviewed"]) mkdirSync(join(state, directory), { recursive: true });
  writeFileSync(
    join(state, "debounce", `${legacyKey}.json`),
    JSON.stringify({ file: legacyFile, generation: 7, burstStartedAt: 1 }),
  );
  writeFileSync(join(state, "reviewed", `${legacyKey}.json`), JSON.stringify({ file: legacyFile, reviewedGen: 7 }));
  expect(readEditRecord(repo, file)).toMatchObject({ generation: 7, reviewedGen: 7 });
  expect(bumpEditRecord(repo, file, { now: 100 })).toMatchObject({
    generation: 8,
    reviewedGen: 7,
    burstStartedAt: 100,
  });
  expect(bumpEditRecord(alias, legacyFile, { now: 200 })).toMatchObject({ generation: 9, burstStartedAt: 100 });
  markReviewed(alias, legacyFile, 9);
  expect(readEditRecord(repo, file)).toMatchObject({ generation: 9, reviewedGen: 9 });
  const lock = tryAcquireInflightLock(repo, file, 60_000);
  expect(lock.acquired).toBe(true);
  expect(tryAcquireInflightLock(alias, legacyFile, 60_000).acquired).toBe(false);
  releaseInflightLock(lock.lockPath);
});

it("Grok start and both resume paths leave shell-written files for foreground review", () => {
  marker();
  shellWrite("shell.ts");
  const env = { CODEX_PAIR_HOST: "grok" };
  run(LOG, { args: ["start"], env });
  expect(report()).toEqual([{ repository: repo, file: "shell.ts", status: "not-started" }]);
  run(LOG, { args: ["pause"], env });
  run(LOG, { args: ["resume"], env });
  expect(report()).toEqual([{ repository: repo, file: "shell.ts", status: "not-started" }]);
  writeFileSync(
    pausePath(repo),
    JSON.stringify({ v: 1, kind: "quota", reason: "usage limit", at: new Date(0).toISOString() }),
  );
  shellWrite("edit.ts");
  const output = run(WATCH, {
    env: { ...env, CODEX_PAIR_FORCE_SYNC: "1" },
    event: { tool_name: "Edit", tool_input: { file_path: join(repo, "edit.ts") } },
  });
  expect(JSON.parse(output).hookSpecificOutput.additionalContext).toContain("codex-pair OK:");
  expect(report()).toEqual([{ repository: repo, file: "shell.ts", status: "not-started" }]);
  expect(receivedCalls()).toBe(1);
});

it.each(["start", "edit"])("rejects a cached review from fallback A after switching to B via %s", async (trigger) => {
  const primary = "gpt-6.2-sol";
  const fallbackA = "gpt-6.1-terra";
  const fallbackB = "gpt-6-terra";
  const configure = (fallback: string) => marker(`debounceMs: 0\nmodel: ${primary}\nfallbackModel: ${fallback}`);
  const event = { tool_name: "Edit", tool_input: { file_path: join(repo, "tracked.ts") } };
  const review = (attempt: string) =>
    run(trigger === "edit" ? WATCH : LOG, {
      args: trigger === "edit" ? [] : ["start"],
      event,
      scenario: "quota-plan-recover",
      env: { FAKE_CODEX_ATTEMPT_FILE: join(scratch, attempt) },
    });
  const modelsCalled = () =>
    readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const args = JSON.parse(line);
        return args[args.indexOf("-m") + 1];
      });
  configure(fallbackA);
  shellWrite("tracked.ts");
  run(WATCH, {
    event,
    scenario: "quota-plan-recover",
    env: { FAKE_CODEX_ATTEMPT_FILE: join(scratch, "initial") },
  });
  expect(log().at(-1)).toMatchObject({ verdict: "none", model: fallbackA, fellBack: true });
  expect(modelsCalled()).toEqual([primary, fallbackA]);

  configure(fallbackB);
  expect(report()).toEqual([{ repository: repo, file: "tracked.ts", status: "not-started" }]);
  review("switched");
  await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);
  expect(modelsCalled()).toEqual([primary, fallbackA, primary, fallbackB]);
  expect(log().at(-1)).toMatchObject({ verdict: "none", model: fallbackB, fellBack: true });

  configure(fallbackB);
  review("compatible");
  await expect.poll(() => log().at(-1)?.verdict, { timeout: 5000 }).toBe("cached");
  expect(log().at(-1)).toMatchObject({ model: fallbackB, fellBack: true });
  expect(modelsCalled()).toEqual([primary, fallbackA, primary, fallbackB]);
  expect(report()).toEqual([]);
});

it("retains a primary-model cache hit when only fallback selection changes", async () => {
  const primary = "gpt-6.2-sol";
  marker(`debounceMs: 0\nmodel: ${primary}\nfallbackModel: gpt-6.1-terra`);
  shellWrite("tracked.ts");
  edit("tracked.ts");
  expect(log().at(-1)).toMatchObject({ verdict: "none", model: primary, fellBack: false });
  expect(receivedCalls()).toBe(1);

  marker(`debounceMs: 0\nmodel: ${primary}\nfallbackModel: gpt-6-terra`);
  expect(report()).toEqual([{ repository: repo, file: "tracked.ts", status: "not-started" }]);
  run(LOG, { args: ["start"], scenario: "exit-nonzero" });
  await expect.poll(() => report(), { timeout: 5000 }).toEqual([]);
  expect(log().at(-1)).toMatchObject({ verdict: "cached", model: primary, fellBack: false });
  expect(receivedCalls()).toBe(1);
});
