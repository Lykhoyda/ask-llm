import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SKILLS_NOTICE =
  "Ask LLM skills are not installed for Pi; run `ask-llm setup --host pi` to add the /skill:ask-llm-* workflows.";

// Pi reads the skills from ~/.agents/skills (installed by setup), not from this package.
export function registerSkillsNotice(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    const installed = pi
      .getCommands()
      .some(({ name, source }) => source === "skill" && name.replace(/^skill:/, "").startsWith("ask-llm-"));
    if (!installed) ctx.ui.notify(SKILLS_NOTICE, "info");
  });
}
