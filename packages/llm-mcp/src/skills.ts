import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DetectedHost } from "./hosts/detect.js";
import type { HostId } from "./hosts/registry.js";
import { runHost } from "./hosts/spawn.js";
import { commandText } from "./plan.js";
import type { Confirm } from "./setup.js";

// Bump only together with a smoke run of the new version (ADR-183).
export const SKILLS_CLI_VERSION = "1.7.0";
export const SKILLS_SOURCE = "Lykhoyda/ask-llm";
export const PACKAGE_SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));

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
  names: string[];
  agents: PlannedHost[];
  upToDate: Array<{ id: HostId; name: string }>;
  manual: Array<{ id: HostId; name: string; command: string }>;
  argv?: string[];
  command?: string;
}

// Old-name pointer folders stay out so no host gets a skill twice.
export function portableSkills(dir = PACKAGE_SKILLS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.startsWith("ask-llm-") && !CLAUDE_ONLY.has(name))
    .sort();
}

function hasAll(dir: string, names: string[]): boolean {
  return names.every((name) => existsSync(join(dir, name, "SKILL.md")));
}

export function planSkills(
  hosts: DetectedHost[],
  selected: HostId[] | undefined,
  packageDir = PACKAGE_SKILLS_DIR,
): SkillsPlan {
  const names = portableSkills(packageDir);
  const plan: SkillsPlan = { names, agents: [], upToDate: [], manual: [] };
  for (const { id, name, installed, spec } of hosts) {
    const dir = spec.skillsDir;
    if (!installed || (selected && !selected.includes(id)) || spec.pluginInstall || !dir) continue;
    if (hasAll(dir, names)) plan.upToDate.push({ id, name });
    else if (spec.skillsAgent) plan.agents.push({ id, name, agent: spec.skillsAgent, dir });
    else {
      const copy = ["cp", "-R", ...names.map((skill) => join(packageDir, skill)), `${dir}/`];
      plan.manual.push({ id, name, command: `${commandText(["mkdir", "-p", dir])} && ${commandText(copy)}` });
    }
  }
  if (plan.agents.length > 0) {
    const agents = plan.agents.map(({ agent }) => agent);
    plan.argv = ["npx", "-y", `skills@${SKILLS_CLI_VERSION}`, "add", SKILLS_SOURCE, "--skill", ...names, "-g"];
    plan.argv.push("-a", ...agents, "-y");
    plan.command = `DISABLE_TELEMETRY=1 ${commandText(plan.argv)}`;
  }
  return plan;
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/).find((line) => line.trim()) ?? "").trim().slice(0, 300);
}

export async function installSkills(
  plan: SkillsPlan,
  confirm: Confirm,
  env: NodeJS.ProcessEnv,
): Promise<WorkflowResult[]> {
  const results: WorkflowResult[] = [
    ...plan.upToDate.map(({ id, name }) => ({ id, name, label: `${name} skills`, status: "up-to-date" as const })),
    ...plan.manual.map(({ id, name, command }) => ({
      id,
      name,
      label: `${name} skills`,
      status: "manual" as const,
      detail: `skills@${SKILLS_CLI_VERSION} has no agent id that writes ${name}'s skills folder`,
      manual: command,
    })),
  ];
  const { argv, command, agents, names } = plan;
  if (!argv || !command) return results;
  const hostList = agents.map(({ name }) => name).join(", ");
  const done = (status: WorkflowStatus, extra: Partial<WorkflowResult> = {}) =>
    agents.map(({ id, name }) => ({ id, name, label: `${name} skills`, status, ...extra }));
  if (!(await confirm(`Install the Ask LLM skills for ${hostList}? Runs: ${command}`))) {
    return [...results, ...done("declined")];
  }
  const run = await runHost(argv[0], argv.slice(1), { ...env, DISABLE_TELEMETRY: "1" }, SKILLS_TIMEOUT_MS);
  if (run.code !== 0) {
    const detail = `${firstLine(`${run.stderr}\n${run.stdout}`) || "no output"} (exit ${run.code ?? "timeout or signal"})`;
    return [...results, ...done("failed", { detail, manual: command })];
  }
  return [
    ...results,
    ...agents.map(({ id, name, dir }) =>
      hasAll(dir, names)
        ? { id, name, label: `${name} skills`, status: "installed" as const }
        : {
            id,
            name,
            label: `${name} skills`,
            status: "failed" as const,
            detail: `the skills CLI exited 0 but ${dir} lacks some Ask LLM skills`,
            manual: command,
          },
    ),
  ];
}
