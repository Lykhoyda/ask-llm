import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DetectedHost } from "../hosts/detect.js";
import { type HostId, hostSpecs } from "../hosts/registry.js";
import { installSkills, planSkills, portableSkills, SKILLS_CLI_VERSION } from "../skills.js";
import { installFakeNpx } from "./_hostFakes.js";

const PACKAGE_SKILLS = join(__dirname, "..", "..", "skills");
const NAMES = portableSkills(PACKAGE_SKILLS);

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ask-llm-skills-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  installFakeNpx(bin);
  env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

function hosts(installed: HostId[]): DetectedHost[] {
  return hostSpecs(env).map((spec) => ({
    id: spec.id,
    name: spec.name,
    installed: installed.includes(spec.id),
    supported: true,
    leftoverConfig: false,
    registered: false,
    spec,
  }));
}

const argv = () => readFileSync(join(home, "npx-argv"), "utf8").trim().split("\n");
const yes = async () => true;

describe("portable skill list", () => {
  it("is every namespaced folder except the Claude-only fable-review, never an old-name pointer", () => {
    const folders = readdirSync(PACKAGE_SKILLS).filter((name) => name.startsWith("ask-llm-"));
    expect(NAMES).toEqual(folders.filter((name) => name !== "ask-llm-fable-review").sort());
    expect(NAMES).toContain("ask-llm-review");
    expect(NAMES).not.toContain("codex-review");
  });
});

describe("installSkills through the pinned skills CLI", () => {
  it("runs one npx call with the pinned version, the --skill list, -g, the agent ids and -y", async () => {
    const plan = planSkills(hosts(["codex", "cursor", "grok", "pi"]), undefined, PACKAGE_SKILLS);
    const results = await installSkills(plan, yes, env);
    expect(argv()).toEqual([
      ["-y", `skills@${SKILLS_CLI_VERSION}`, "add", "Lykhoyda/ask-llm", "--skill", ...NAMES, "-g", "-a"]
        .concat(["codex", "grok", "cursor", "pi", "-y"])
        .join(" "),
    ]);
    expect(results.map(({ id, status }) => [id, status])).toEqual([
      ["codex", "installed"],
      ["grok", "installed"],
      ["cursor", "installed"],
      ["pi", "installed"],
    ]);
    expect(SKILLS_CLI_VERSION).toBe("1.7.0");
  });

  it("keeps a host that takes the Claude plugin, or has no skills, out of -a", () => {
    const plan = planSkills(hosts(["claude", "claude-desktop", "codex"]), undefined, PACKAGE_SKILLS);
    expect(plan.agents.map(({ agent }) => agent)).toEqual(["codex"]);
    expect(plan.argv).toContain("codex");
    expect(plan.argv).not.toContain("claude-code");
  });

  it("filters -a by --host and skips hosts that are not installed", () => {
    const plan = planSkills(hosts(["codex", "cursor", "grok"]), ["cursor", "gemini"], PACKAGE_SKILLS);
    expect(plan.agents.map(({ id }) => id)).toEqual(["cursor"]);
  });

  it("prints an exact copy command for a host the skills CLI cannot reach, and never adds it to -a", () => {
    const plan = planSkills(hosts(["agy"]), undefined, PACKAGE_SKILLS);
    expect(plan.argv).toBeUndefined();
    expect(plan.manual).toHaveLength(1);
    const { command } = plan.manual[0];
    expect(command).toContain(`mkdir -p ${join(home, ".gemini", "config", "skills")}`);
    expect(command).toContain(" && cp -R ");
    for (const name of NAMES) expect(command).toContain(join(PACKAGE_SKILLS, name));
    expect(command.endsWith(`${join(home, ".gemini", "config", "skills")}/`)).toBe(true);
  });

  it("reports a non-zero exit per host with the manual command", async () => {
    writeFileSync(join(home, "npx-mode"), "fail");
    const plan = planSkills(hosts(["codex", "grok"]), undefined, PACKAGE_SKILLS);
    const results = await installSkills(plan, yes, env);
    expect(results.map(({ status }) => status)).toEqual(["failed", "failed"]);
    expect(results[0].detail).toContain("network error (exit 1)");
    expect(results[0].manual).toBe(plan.command);
    expect(plan.command).toMatch(/^DISABLE_TELEMETRY=1 npx -y skills@1\.7\.0 add Lykhoyda\/ask-llm --skill /);
  });

  it("fails with the manual command when the CLI rejects an agent id", async () => {
    const plan = planSkills(hosts(["codex"]), undefined, PACKAGE_SKILLS);
    const rejected = { ...plan, argv: plan.argv?.map((arg) => (arg === "codex" ? "unknown-agent" : arg)) };
    const [result] = await installSkills(rejected, yes, env);
    expect(result).toMatchObject({ id: "codex", status: "failed", manual: plan.command });
    expect(result.detail).toContain("Invalid agents: unknown-agent");
  });

  it("changes nothing when every portable skill is already present", async () => {
    await installSkills(planSkills(hosts(["codex"]), undefined, PACKAGE_SKILLS), yes, env);
    const again = planSkills(hosts(["codex"]), undefined, PACKAGE_SKILLS);
    expect(again.argv).toBeUndefined();
    expect(again.upToDate.map(({ id }) => id)).toEqual(["codex"]);
    expect(await installSkills(again, yes, env)).toEqual([
      expect.objectContaining({ id: "codex", status: "up-to-date" }),
    ]);
    expect(argv()).toHaveLength(1);
  });

  it("runs nothing when the user declines", async () => {
    const plan = planSkills(hosts(["codex"]), undefined, PACKAGE_SKILLS);
    const [result] = await installSkills(plan, async () => false, env);
    expect(result.status).toBe("declined");
    expect(() => argv()).toThrow();
  });
});
