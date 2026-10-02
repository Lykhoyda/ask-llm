import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DetectedHost } from "../hosts/detect.js";
import { type HostId, hostSpecs } from "../hosts/registry.js";
import { installSkills, planSkills, portableSkills, SKILLS_CLI_VERSION } from "../skills.js";
import { installFakeNpx } from "./_hostFakes.js";

const PACKAGE_ROOT = join(__dirname, "..", "..");
const PACKAGE_SKILLS = join(PACKAGE_ROOT, "skills");
const VERSION = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;
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

function fixturePackage(): string {
  const source = join(home, "installed package");
  for (const name of ["ask-llm-review", "ask-llm-compare"]) {
    const dir = join(source, "skills", name);
    mkdirSync(join(dir, "references"), { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\nVersion one\n`);
    writeFileSync(join(dir, "references", "data.bin"), Buffer.from([0, 1, 255]));
  }
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "@ask-llm/mcp", version: "1.0.0" }));
  return source;
}

describe("portable skill list", () => {
  it("is every namespaced folder except the Claude-only fable-review, never an old-name pointer", () => {
    const folders = readdirSync(PACKAGE_SKILLS).filter((name) => name.startsWith("ask-llm-"));
    expect(NAMES).toEqual(folders.filter((name) => name !== "ask-llm-fable-review").sort());
    expect(NAMES).toContain("ask-llm-review");
    expect(NAMES).not.toContain("codex-review");
  });
});

describe("skills source", () => {
  it("is the running package's own directory and version, never a remote repository", () => {
    const plan = planSkills(hosts(["codex"]), undefined);
    expect(plan.source).toEqual({ dir: PACKAGE_ROOT, version: VERSION });
    expect(plan.argv?.slice(0, 5)).toEqual(["npx", "-y", `skills@${SKILLS_CLI_VERSION}`, "add", PACKAGE_ROOT]);
    expect(plan.argv).not.toContain("Lykhoyda/ask-llm");
  });

  it("follows the installed package it is given, with that package's version", async () => {
    const installed = join(home, "lib", "node_modules", "@ask-llm", "mcp");
    cpSync(PACKAGE_SKILLS, join(installed, "skills"), { recursive: true });
    writeFileSync(
      join(installed, "package.json"),
      JSON.stringify({ name: "@ask-llm/mcp", version: "9.9.9-installed" }),
    );
    const plan = planSkills(hosts(["codex"]), undefined, installed);
    expect(plan.source).toEqual({ dir: installed, version: "9.9.9-installed" });
    expect(plan.argv?.[4]).toBe(installed);
    expect(await installSkills(plan, yes, env)).toEqual([
      expect.objectContaining({ id: "codex", status: "installed" }),
    ]);
    const copied = join(home, ".agents", "skills", "ask-llm-review", "SKILL.md");
    expect(readFileSync(copied, "utf8")).toBe(
      readFileSync(join(installed, "skills", "ask-llm-review", "SKILL.md"), "utf8"),
    );
  });
});

describe("installSkills through the pinned skills CLI", () => {
  it("runs one npx call with the pinned version, the --skill list, -g, the agent ids and -y", async () => {
    const plan = planSkills(hosts(["codex", "cursor", "grok", "pi"]), undefined, PACKAGE_ROOT);
    const results = await installSkills(plan, yes, env);
    expect(argv()).toEqual([
      ["-y", `skills@${SKILLS_CLI_VERSION}`, "add", PACKAGE_ROOT, "--skill", ...NAMES, "-g", "-a"]
        .concat(["codex", "grok", "cursor", "-y"])
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
    const plan = planSkills(hosts(["claude", "claude-desktop", "codex"]), undefined, PACKAGE_ROOT);
    expect(plan.agents.map(({ agent }) => agent)).toEqual(["codex"]);
    expect(plan.argv).toContain("codex");
    expect(plan.argv).not.toContain("claude-code");
  });

  it("filters -a by --host and skips hosts that are not installed", () => {
    const plan = planSkills(hosts(["codex", "cursor", "grok"]), ["cursor", "gemini"], PACKAGE_ROOT);
    expect(plan.agents.map(({ id }) => id)).toEqual(["cursor"]);
  });

  it("prints an exact copy command for a host the skills CLI cannot reach, and never adds it to -a", () => {
    const plan = planSkills(hosts(["agy"]), undefined, PACKAGE_ROOT);
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
    const plan = planSkills(hosts(["codex", "grok"]), undefined, PACKAGE_ROOT);
    const results = await installSkills(plan, yes, env);
    expect(results.map(({ status }) => status)).toEqual(["failed", "failed"]);
    expect(results[0].detail).toContain("network error (exit 1)");
    expect(results[0].manual).toBe(plan.command);
    expect(plan.command?.startsWith(`DISABLE_TELEMETRY=1 npx -y skills@1.7.0 add ${PACKAGE_ROOT} --skill `)).toBe(true);
  });

  it("fails with the manual command when the CLI rejects an agent id", async () => {
    const plan = planSkills(hosts(["codex"]), undefined, PACKAGE_ROOT);
    const rejected = { ...plan, argv: plan.argv?.map((arg) => (arg === "codex" ? "unknown-agent" : arg)) };
    const [result] = await installSkills(rejected, yes, env);
    expect(result).toMatchObject({ id: "codex", status: "failed", manual: plan.command });
    expect(result.detail).toContain("Invalid agents: unknown-agent");
  });

  it("changes nothing when every portable skill has identical contents", async () => {
    await installSkills(planSkills(hosts(["codex"]), undefined, PACKAGE_ROOT), yes, env);
    const again = planSkills(hosts(["codex"]), undefined, PACKAGE_ROOT);
    expect(again.argv).toBeUndefined();
    expect(again.upToDate.map(({ id }) => id)).toEqual(["codex"]);
    expect(await installSkills(again, yes, env)).toEqual([
      expect.objectContaining({ id: "codex", status: "up-to-date" }),
    ]);
    expect(argv()).toHaveLength(1);
  });

  it("refreshes changed skill text on upgrade while leaving identical and foreign skills untouched", async () => {
    const source = fixturePackage();
    const installed = join(home, ".agents", "skills");
    await installSkills(planSkills(hosts(["codex"]), undefined, source), yes, env);
    const foreign = join(installed, "my-skill", "SKILL.md");
    mkdirSync(join(foreign, ".."));
    writeFileSync(foreign, "user-owned");
    const unchanged = join(installed, "ask-llm-compare", "SKILL.md");
    const before = [statSync(unchanged).mtimeMs, statSync(foreign).mtimeMs];
    const updated = "---\nname: ask-llm-review\n---\nVersion two\n";
    writeFileSync(join(source, "skills", "ask-llm-review", "SKILL.md"), updated);
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "@ask-llm/mcp", version: "2.0.0" }));

    const plan = planSkills(hosts(["codex"]), undefined, source);
    expect(plan.source.version).toBe("2.0.0");
    expect(plan.argv?.slice(5)).toEqual(["--skill", "ask-llm-review", "-g", "-a", "codex", "-y"]);
    expect(await installSkills(plan, yes, env)).toEqual([expect.objectContaining({ status: "installed" })]);
    expect(readFileSync(join(installed, "ask-llm-review", "SKILL.md"), "utf8")).toBe(updated);
    expect(readFileSync(foreign, "utf8")).toBe("user-owned");
    expect([statSync(unchanged).mtimeMs, statSync(foreign).mtimeMs]).toEqual(before);
    expect(planSkills(hosts(["codex"]), undefined, source).argv).toBeUndefined();
    expect(argv()).toHaveLength(2);
  });

  it.each(["changed bytes", "missing file", "extra file", "wrong type"])(
    "detects and repairs %s in a skill's supporting files",
    async (defect) => {
      const source = fixturePackage();
      await installSkills(planSkills(hosts(["codex"]), undefined, source), yes, env);
      const reference = join(home, ".agents", "skills", "ask-llm-review", "references", "data.bin");
      if (defect === "changed bytes") writeFileSync(reference, Buffer.from([0, 2, 255]));
      if (defect === "missing file") rmSync(reference);
      if (defect === "extra file") writeFileSync(`${reference}.old`, "obsolete");
      if (defect === "wrong type") {
        rmSync(reference);
        mkdirSync(reference);
      }
      const plan = planSkills(hosts(["codex"]), undefined, source);
      expect(plan.agents.map(({ id }) => id)).toEqual(["codex"]);
      writeFileSync(join(home, "npx-mode"), "silent");
      const [failed] = await installSkills(plan, yes, env);
      expect(failed).toMatchObject({ status: "failed", manual: plan.command });
      expect(failed.detail).toContain("does not match the packaged Ask LLM skills");
      writeFileSync(join(home, "npx-mode"), "ok");
      expect(await installSkills(plan, yes, env)).toEqual([expect.objectContaining({ status: "installed" })]);
      expect(readFileSync(reference)).toEqual(Buffer.from([0, 1, 255]));
      expect(existsSync(`${reference}.old`)).toBe(false);
      expect(planSkills(hosts(["codex"]), undefined, source).argv).toBeUndefined();
    },
  );

  it("refreshes Antigravity through its manual command and preserves foreign skills", () => {
    const source = fixturePackage();
    const dir = join(home, ".gemini", "config", "skills");
    const foreign = join(dir, "my-skill", "SKILL.md");
    mkdirSync(join(foreign, ".."), { recursive: true });
    writeFileSync(foreign, "user-owned");
    const runCopy = () => {
      const plan = planSkills(hosts(["agy"]), undefined, source);
      expect(plan.manual).toHaveLength(1);
      execFileSync("sh", ["-c", plan.manual[0].command], { env });
    };
    runCopy();
    expect(planSkills(hosts(["agy"]), undefined, source).upToDate).toHaveLength(1);
    const reference = join(dir, "ask-llm-review", "references", "data.bin");
    writeFileSync(reference, "stale");
    writeFileSync(`${reference}.old`, "obsolete");
    const updated = "---\nname: ask-llm-review\n---\nVersion two\n";
    writeFileSync(join(source, "skills", "ask-llm-review", "SKILL.md"), updated);
    runCopy();
    expect(readFileSync(join(dir, "ask-llm-review", "SKILL.md"), "utf8")).toBe(updated);
    expect(readFileSync(reference)).toEqual(Buffer.from([0, 1, 255]));
    expect(existsSync(`${reference}.old`)).toBe(false);
    expect(readFileSync(foreign, "utf8")).toBe("user-owned");
    const again = planSkills(hosts(["agy"]), undefined, source);
    expect(again.manual).toEqual([]);
    expect(again.upToDate).toEqual([{ id: "agy", name: "Antigravity" }]);
  });

  it.each(["codex", "cursor"] as const)("reuses Pi's shared skills when adding %s", async (nextHost) => {
    const first = planSkills(hosts(["pi"]), ["pi"], PACKAGE_ROOT);
    expect(await installSkills(first, yes, env)).toEqual([expect.objectContaining({ id: "pi", status: "installed" })]);
    const next = planSkills(hosts(["pi", nextHost]), [nextHost], PACKAGE_ROOT);
    expect(await installSkills(next, yes, env)).toEqual([
      expect.objectContaining({ id: nextHost, status: "up-to-date" }),
    ]);
    expect(argv()).toHaveLength(1);
  });

  it("runs nothing when the user declines", async () => {
    const plan = planSkills(hosts(["codex"]), undefined, PACKAGE_ROOT);
    const [result] = await installSkills(plan, async () => false, env);
    expect(result.status).toBe("declined");
    expect(() => argv()).toThrow();
  });
});
