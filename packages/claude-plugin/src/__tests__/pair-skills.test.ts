import { describe, expect, it } from "vitest";
import { readFile } from "./_helpers.js";

const contract = readFile("skills/pairing-contract.md");
const codex = readFile("skills/codex-pair/SKILL.md");
const grok = readFile("skills/grok-pair/SKILL.md");

describe("portable pair lifecycle", () => {
  it("bounds context, gates consent, relays findings, and terminates every lifecycle", () => {
    expect(contract).toMatch(/idle -> consented -> active -> completed \| cancelled \| failed/);
    expect(contract).toMatch(/20 KB per file/);
    expect(contract).toMatch(/100 KB per provider request/);
    expect(contract).toMatch(/Refusal returns `cancelled` without.*invoking a provider/s);
    expect(contract).toMatch(/relay each reviewer response before acting/);
    expect(contract).toMatch(/failed \(partial\)/);
    expect(contract).toMatch(/interrupt cancels the in-flight MCP call/);
  });

  it("keeps transport/model attribution exact with no fallback", () => {
    for (const phrase of [
      "host harness",
      "provider",
      "execution harness/transport",
      "exact requested model ID",
      "reportedModel",
      "Never choose Cursor Auto",
      "Never silently drop a requested directory",
    ]) {
      expect(contract).toContain(phrase);
    }
    expect(contract).toMatch(/missing tool is a setup failure.*never permission to use a generic call/s);
  });
});

describe("Claude /grok-pair", () => {
  it("selects Cursor, xAI API, or Grok CLI explicitly and never silently falls back", () => {
    expect(grok).toContain("route=cursor-agent");
    expect(grok).toContain("route=xai-api");
    expect(grok).toContain("route=grok-cli");
    expect(grok).toContain('provider: "grok"');
    expect(grok).toContain("never use Auto");
    expect(grok).toMatch(/route\/model\/effort are immutable/);
    expect(grok).toMatch(/failure is terminal for that route/);
  });

  it("covers consent refusal, include dirs, sessions, partial failure, cancellation, and diagnostics", () => {
    expect(grok).toContain("AskUserQuestion");
    expect(grok).toMatch(/Do not invoke a tool.*on refusal/);
    expect(grok).toContain("includeDirs");
    expect(grok).toContain("reuse the returned `sessionId`");
    expect(grok).toContain("failed (partial)");
    expect(grok).toMatch(/user cancels or interrupts.*stop the in-flight MCP call/s);
    expect(grok).toContain("Missing Cursor tool");
    expect(grok).toContain("Missing direct tool");
    expect(grok).toContain("no fallback was attempted");
  });

  it("keeps Cursor harness/provider/model/display label distinct", () => {
    expect(grok).toContain("Host: Claude Code");
    expect(grok).toContain("Reviewer provider: grok");
    expect(grok).toContain("Requested model:");
    expect(grok).toContain("Reported model:");
    expect(grok).toMatch(/cross-provider label.*failure/);
  });
});

describe("Cursor Agent /codex-pair", () => {
  it("uses Cursor skills and exact ask-codex capability without Claude-only assumptions", () => {
    expect(codex).toMatch(/Cursor discovers this `SKILL\.md`/);
    for (const claudeOnly of ["PostToolUse", "Stop", "CLAUDE_PLUGIN_ROOT", "AskUserQuestion"]) {
      expect(codex).toContain(claudeOnly);
    }
    expect(codex).toMatch(/Do \*\*not\*\* use Claude Code/);
    expect(codex).toMatch(/exact leaf is `ask-codex`/);
    expect(codex).toMatch(/do not.*generic `ask-llm`/);
  });

  it("preserves effort, includes, persisted session, cancellation, and failure relay", () => {
    expect(codex).toContain("reasoningEffort");
    expect(codex).toContain("includeDirs");
    expect(codex).toContain('sessionId: ""');
    expect(codex).toMatch(/Omit `includeDirs` on resumed calls/);
    expect(codex).toMatch(/Cursor interrupt cancels the MCP request/);
    expect(codex).toContain("failed (partial)");
    expect(codex).toContain("@ask-llm/codex-mcp");
  });

  it("preserves the existing Claude adapter", () => {
    expect(codex).toContain("<!-- HOST-ADAPTER:CLAUDE-CODE:START -->");
    expect(codex).toContain("Phase 1: Detect current state");
    expect(codex).toContain("Phase 3: Interactive setup");
    expect(codex).toContain("Phase 5: Active dashboard");
  });
});
