import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DetectedHost } from "../hosts/detect.js";
import { type HostId, hostSpecs } from "../hosts/registry.js";
import { installPlugins, planPlugins } from "../plugins.js";

// Replies mirror Claude Code 2.1.284 in the temp-HOME probes: both commands are idempotent and exit 0.
const FAKE_CLAUDE = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/claude-argv"
[ "$(cat "$HOME/claude-mode" 2>/dev/null)" = fail ] && { echo "Failed to clone marketplace" >&2; exit 1; }
p="$HOME/.claude/plugins"; mkdir -p "$p"
case "$*" in
  "plugin marketplace add Lykhoyda/ask-llm") echo '{"ask-llm-plugins":{"source":{"source":"github","repo":"Lykhoyda/ask-llm"}}}' > "$p/known_marketplaces.json" ;;
  "plugin install ask-llm@ask-llm-plugins") echo '{"version":2,"plugins":{"ask-llm@ask-llm-plugins":[{"scope":"user"}]}}' > "$p/installed_plugins.json"; echo '{"enabledPlugins":{"ask-llm@ask-llm-plugins":true}}' > "$HOME/.claude/settings.json" ;;
esac
`;

let home: string;
let binary: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ask-llm-plugins-"));
  mkdirSync(join(home, "bin"));
  binary = join(home, "bin", "claude");
  writeFileSync(binary, FAKE_CLAUDE);
  chmodSync(binary, 0o755);
  env = { HOME: home, PATH: `${join(home, "bin")}:/usr/bin:/bin` };
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

function hosts(installed: HostId[]): DetectedHost[] {
  return hostSpecs(env).map((spec) => ({
    id: spec.id,
    name: spec.name,
    installed: installed.includes(spec.id),
    binary: installed.includes(spec.id) ? join(home, "bin", spec.binaries[0]) : undefined,
    supported: true,
    leftoverConfig: false,
    registered: false,
    spec,
  }));
}

const argv = () => readFileSync(join(home, "claude-argv"), "utf8").trim().split("\n");
const yes = async () => true;

describe("Claude Code plugin install", () => {
  it("adds the marketplace, then installs the plugin, and verifies both", async () => {
    const [result] = await installPlugins(planPlugins(hosts(["claude"]), undefined), yes, env);
    expect(argv()).toEqual(["plugin marketplace add Lykhoyda/ask-llm", "plugin install ask-llm@ask-llm-plugins"]);
    expect(result).toMatchObject({ id: "claude", status: "installed" });
  });

  it("is the only plugin route: every other host takes skills, not a marketplace", () => {
    const plans = planPlugins(
      hosts(["claude", "codex", "agy", "grok", "cursor", "gemini", "pi", "opencode"]),
      undefined,
    );
    expect(plans.map(({ id }) => id)).toEqual(["claude"]);
  });

  it("backs up an existing settings.json before the first command, and never writes hooks there itself", async () => {
    mkdirSync(join(home, ".claude"));
    writeFileSync(join(home, ".claude", "settings.json"), '{"theme":"dark"}\n');
    const [result] = await installPlugins(planPlugins(hosts(["claude"]), undefined), yes, env);
    expect(result.backup).toMatch(/settings\.json\.ask-llm-backup-/);
    expect(readFileSync(result.backup as string, "utf8")).toBe('{"theme":"dark"}\n');
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).not.toContain("hooks");
  });

  it("changes nothing on a second run", async () => {
    await installPlugins(planPlugins(hosts(["claude"]), undefined), yes, env);
    const [again] = await installPlugins(planPlugins(hosts(["claude"]), undefined), yes, env);
    expect(again.status).toBe("up-to-date");
    expect(argv()).toHaveLength(2);
  });

  it("installs at user scope when the plugin is only installed for one project", async () => {
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      '{"version":2,"plugins":{"ask-llm@ask-llm-plugins":[{"scope":"project","projectPath":"/other/repo"}]}}',
    );
    const [plan] = planPlugins(hosts(["claude"]), undefined);
    expect(plan.installed).toBe(false);
    const [result] = await installPlugins([plan], yes, env);
    expect(result.status).toBe("installed");
    expect(argv()).toContain("plugin install ask-llm@ask-llm-plugins");
  });

  it("skips the marketplace add when the marketplace is already known", async () => {
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(join(home, ".claude", "plugins", "known_marketplaces.json"), '{"ask-llm-plugins":{}}');
    await installPlugins(planPlugins(hosts(["claude"]), undefined), yes, env);
    expect(argv()).toEqual(["plugin install ask-llm@ask-llm-plugins"]);
  });

  it("reports a failed command with both manual commands and stops", async () => {
    writeFileSync(join(home, "claude-mode"), "fail");
    const [result] = await installPlugins(planPlugins(hosts(["claude"]), undefined), yes, env);
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("Failed to clone marketplace (exit 1)");
    expect(result.manual).toBe(
      "claude plugin marketplace add Lykhoyda/ask-llm && claude plugin install ask-llm@ask-llm-plugins",
    );
    expect(argv()).toHaveLength(1);
  });

  it("runs nothing when declined or when Claude Code is out of scope", async () => {
    const [declined] = await installPlugins(planPlugins(hosts(["claude"]), undefined), async () => false, env);
    expect(declined.status).toBe("declined");
    expect(planPlugins(hosts(["claude"]), ["codex"])).toEqual([]);
    expect(existsSync(join(home, "claude-argv"))).toBe(false);
    expect(readdirSync(home)).not.toContain(".claude");
  });
});
