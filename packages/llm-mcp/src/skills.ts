import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { firstLine } from "./hosts/apply.js";
import type { DetectedHost } from "./hosts/detect.js";
import type { HostId } from "./hosts/registry.js";
import { runHost } from "./hosts/spawn.js";
import { PACKAGE_DIR, packageVersion } from "./packageMetadata.js";
import { commandText } from "./plan.js";
import type { Confirm } from "./setup.js";

// Bump only together with a smoke run of the new version (ADR-183).
export const SKILLS_CLI_VERSION = "1.7.0";

const SKILLS_TIMEOUT_MS = 300_000;
// Claude Code gets fable-review through its plugin; no other host can run the native Fable reviewer.
const CLAUDE_ONLY = new Set(["ask-llm-fable-review"]);

export type WorkflowStatus = "installed" | "up-to-date" | "declined" | "manual" | "failed";

export interface WorkflowResult {
  id: HostId;
  name: string;
  label: string;
  status: WorkflowStatus;
  detail?: string;
  manual?: string;
  backup?: string;
}

interface PlannedHost {
  id: HostId;
  name: string;
  agent: string;
  dir: string;
}

export interface SkillsPlan {
  // The installed package the skills come from, so they always match the version the user runs.
  source: { dir: string; version: string };
  names: string[];
  agents: PlannedHost[];
  upToDate: Array<{ id: HostId; name: string }>;
  manual: Array<{ id: HostId; name: string; command: string }>;
  argv?: string[];
  command?: string;
}

// Old-name pointer folders stay out so no host gets a skill twice.
export function portableSkills(dir = join(PACKAGE_DIR, "skills")): string[] {
  return readdirSync(dir)
    .filter((name) => name.startsWith("ask-llm-") && !CLAUDE_ONLY.has(name))
    .sort();
}

function sameContents(source: string, target: string): boolean {
  try {
    const original = statSync(source);
    const installed = statSync(target);
    if (original.isDirectory() && installed.isDirectory()) {
      const entries = readdirSync(source);
      return (
        entries.length === readdirSync(target).length &&
        entries.every((name) => sameContents(join(source, name), join(target, name)))
      );
    }
    return original.isFile() && installed.isFile() && readFileSync(source).equals(readFileSync(target));
  } catch {
    return false;
  }
}

export function planSkills(
  hosts: DetectedHost[],
  selected: HostId[] | undefined,
  packageDir = PACKAGE_DIR,
): SkillsPlan {
  const skillsDir = join(packageDir, "skills");
  const names = portableSkills(skillsDir);
  const source = { dir: packageDir, version: packageVersion(packageDir) };
  const plan: SkillsPlan = { source, names, agents: [], upToDate: [], manual: [] };
  const needed = new Set<string>();
  for (const { id, name, installed, spec } of hosts) {
    const dir = spec.skillsDir;
    if (!installed || (selected && !selected.includes(id)) || spec.pluginInstall || !dir) continue;
    const changed = names.filter((skill) => !sameContents(join(skillsDir, skill), join(dir, skill)));
    if (changed.length === 0) plan.upToDate.push({ id, name });
    else if (spec.skillsAgent) {
      plan.agents.push({ id, name, agent: spec.skillsAgent, dir });
      for (const skill of changed) needed.add(skill);
    } else {
      const remove = ["rm", "-rf", "--", ...changed.map((skill) => join(dir, skill))];
      const copy = ["cp", "-R", ...changed.map((skill) => join(skillsDir, skill)), `${dir}/`];
      plan.manual.push({
        id,
        name,
        command: [commandText(["mkdir", "-p", dir]), commandText(remove), commandText(copy)].join(" && "),
      });
    }
  }
  if (plan.agents.length > 0) {
    const agents = [...new Set(plan.agents.map(({ agent }) => agent))];
    const cli = ["npx", "-y", `skills@${SKILLS_CLI_VERSION}`, "add", packageDir];
    plan.argv = [...cli, "--skill", ...names.filter((name) => needed.has(name)), "-g", "-a", ...agents, "-y"];
    plan.command = `DISABLE_TELEMETRY=1 ${commandText(plan.argv)}`;
  }
  return plan;
}

const row = (
  { id, name }: { id: HostId; name: string },
  status: WorkflowStatus,
  extra: Partial<WorkflowResult> = {},
): WorkflowResult => ({ id, name, label: `${name} skills`, status, ...extra });

export async function installSkills(
  plan: SkillsPlan,
  confirm: Confirm,
  env: NodeJS.ProcessEnv,
): Promise<WorkflowResult[]> {
  const { argv, command, agents, names } = plan;
  const results = [
    ...plan.upToDate.map((host) => row(host, "up-to-date")),
    ...plan.manual.map((host) =>
      row(host, "manual", {
        detail: `skills@${SKILLS_CLI_VERSION} has no agent id that writes ${host.name}'s skills folder`,
        manual: host.command,
      }),
    ),
  ];
  if (!argv || !command) return results;
  const hostList = agents.map(({ name }) => name).join(", ");
  if (!(await confirm(`Install the Ask LLM skills for ${hostList}? Runs: ${command}`))) {
    return [...results, ...agents.map((host) => row(host, "declined"))];
  }
  const run = await runHost(argv[0], argv.slice(1), { ...env, DISABLE_TELEMETRY: "1" }, SKILLS_TIMEOUT_MS);
  if (run.code !== 0) {
    const detail = `${firstLine(`${run.stderr}\n${run.stdout}`) || "no output"} (exit ${run.code ?? "timeout or signal"})`;
    return [...results, ...agents.map((host) => row(host, "failed", { detail, manual: command }))];
  }
  const mismatch = (dir: string) => `the skills CLI exited 0 but ${dir} does not match the packaged Ask LLM skills`;
  return [
    ...results,
    ...agents.map((host) =>
      names.every((name) => sameContents(join(plan.source.dir, "skills", name), join(host.dir, name)))
        ? row(host, "installed")
        : row(host, "failed", { detail: mismatch(host.dir), manual: command }),
    ),
  ];
}
