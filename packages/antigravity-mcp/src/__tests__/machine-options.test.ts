import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLI } from "../constants.js";
import { buildArgs } from "../utils/antigravityExecutor.js";
import { readLatestTranscript, snapshotTranscriptState } from "../utils/transcriptReader.js";

describe("Antigravity machine options", () => {
  it("uses plan+sandbox without dangerous permission bypass for machine review", () => {
    const args = buildArgs("review", [], 295, true, "Gemini 3.1 Pro (High)", true);

    expect(args).toContain("--mode");
    expect(args).toContain("plan");
    expect(args).toContain("--sandbox");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("keeps legacy human argv when read-only mode is disabled", () => {
    const args = buildArgs("review", [], 295, true, "Gemini 3.1 Pro (High)", false);

    expect(args).toEqual([
      CLI.FLAGS.PRINT,
      "review",
      CLI.FLAGS.MODEL,
      "Gemini 3.1 Pro (High)",
      CLI.FLAGS.PRINT_TIMEOUT,
      "295s",
      CLI.FLAGS.SKIP_PERMISSIONS,
      CLI.FLAGS.SANDBOX,
    ]);
  });
});

describe("Antigravity machine transcript result", () => {
  const temporaryDirs: string[] = [];

  afterEach(() => {
    for (const dir of temporaryDirs) rmSync(dir, { recursive: true, force: true });
    temporaryDirs.length = 0;
  });

  it("returns the response with a durable transcript path and conversation id", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "agy-machine-test-"));
    temporaryDirs.push(baseDir);
    const before = snapshotTranscriptState(baseDir);
    const conversationId = "conversation-1";
    const logsDir = join(baseDir, "brain", conversationId, ".system_generated", "logs");
    const transcriptPath = join(logsDir, "transcript_full.jsonl");
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(
      transcriptPath,
      JSON.stringify({ source: "MODEL", status: "DONE", type: "PLANNER_RESPONSE", content: "review" }),
    );
    mkdirSync(join(baseDir, "cache"), { recursive: true });
    writeFileSync(join(baseDir, "cache", "last_conversations.json"), JSON.stringify([conversationId]));

    expect(readLatestTranscript(0, before)).toEqual({
      response: "review",
      path: transcriptPath,
      conversationId,
    });
  });
});
