import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DetectedHost } from "../hosts/detect.js";
import { type HostId, hostSpecs } from "../hosts/registry.js";
import { installSkills, planSkills } from "../skills.js";

const PACKAGE_ROOT = join(__dirname, "..", "..");

// Opt in to the real npm installer; ordinary unit tests use the offline host fakes.
describe.skipIf(process.env.ASK_LLM_TEST_SKILLS_INSTALLER !== "1")("pinned skills installer", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "ask-llm-skills-installer-")));
    env = {
      ...process.env,
      HOME: home,
      CODEX_HOME: join(home, ".codex"),
      XDG_CONFIG_HOME: join(home, ".config"),
      PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
    };
    mkdirSync(join(home, "project"));
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  function plan(id: HostId) {
    const hosts: DetectedHost[] = hostSpecs(env).map((spec) => ({
      id: spec.id,
      name: spec.name,
      installed: spec.id === id,
      supported: true,
      leftoverConfig: false,
      registered: false,
      spec,
    }));
    return planSkills(hosts, [id], PACKAGE_ROOT);
  }

  function discover() {
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
const loader = new DefaultResourceLoader({
  cwd: process.env.HOME + "/project",
  agentDir: process.env.PI_CODING_AGENT_DIR,
  settingsManager: SettingsManager.inMemory(),
  noExtensions: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
});
await loader.reload();
console.log(JSON.stringify(loader.getSkills()));`,
      ],
      { env, encoding: "utf8", timeout: 30_000 },
    );
    expect(run.status, run.stderr).toBe(0);
    return JSON.parse(run.stdout) as {
      skills: Array<{ name: string; filePath: string }>;
      diagnostics: Array<{ type: string }>;
    };
  }

  it.each(["codex", "cursor"] as const)(
    "keeps one shared installation when Pi is followed by %s",
    async (nextHost) => {
      const first = plan("pi");
      expect(await installSkills(first, async () => true, env)).toEqual([
        expect.objectContaining({ id: "pi", status: "installed" }),
      ]);
      const sharedFiles = first.names.map((name) => join(home, ".agents", "skills", name, "SKILL.md"));
      expect(sharedFiles.every((file) => existsSync(file))).toBe(true);
      const before = sharedFiles.map((file) => statSync(file).mtimeMs);
      const pi = discover();
      expect(pi.skills.map(({ name }) => name).sort()).toEqual(first.names);
      expect(pi.diagnostics.filter(({ type }) => type === "collision")).toEqual([]);
      expect(pi.skills.map(({ filePath }) => realpathSync(filePath)).sort()).toEqual(sharedFiles.toSorted());

      const next = plan(nextHost);
      expect(next.argv).toBeUndefined();
      expect(await installSkills(next, async () => true, env)).toEqual([
        expect.objectContaining({ id: nextHost, status: "up-to-date" }),
      ]);
      expect(sharedFiles.map((file) => statSync(file).mtimeMs)).toEqual(before);
      expect(discover()).toEqual(pi);
      expect(plan("pi").argv).toBeUndefined();
    },
    120_000,
  );
});
