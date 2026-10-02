import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerSkillsNotice, SKILLS_NOTICE } from "../../pi/extensions/skills-notice.js";

function start(commands: Array<{ name: string; source: string }>, hasUI = true) {
  let handler: ((event: unknown, ctx: unknown) => Promise<void>) | undefined;
  const pi = {
    on: (event: string, fn: typeof handler) => {
      if (event === "session_start") handler = fn;
    },
    getCommands: () => commands,
  } as unknown as ExtensionAPI;
  registerSkillsNotice(pi);
  const notify = vi.fn();
  return handler?.({}, { hasUI, ui: { notify } }).then(() => notify);
}

describe("Pi skills notice", () => {
  it("names the setup command when no ask-llm-* skill is discovered", async () => {
    const notify = await start([
      { name: "codex-pair", source: "extension" },
      { name: "skill:other-review", source: "skill" },
    ]);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(SKILLS_NOTICE, "info");
    expect(SKILLS_NOTICE).toContain("ask-llm setup --host pi");
  });

  it("stays silent once the ask-llm skills are installed", async () => {
    expect(await start([{ name: "skill:ask-llm-review", source: "skill" }])).not.toHaveBeenCalled();
  });

  it("stays silent without a UI", async () => {
    expect(await start([], false)).not.toHaveBeenCalled();
  });
});
