import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backupConfig, firstLine } from "./hosts/apply.js";
import type { DetectedHost } from "./hosts/detect.js";
import type { HostId } from "./hosts/registry.js";
import { runHost } from "./hosts/spawn.js";
import { commandText } from "./plan.js";
import type { Confirm } from "./setup.js";
import type { WorkflowResult, WorkflowStatus } from "./skills.js";

export const CLAUDE_MARKETPLACE = "ask-llm-plugins";
export const CLAUDE_PLUGIN = `ask-llm@${CLAUDE_MARKETPLACE}`;

const PLUGIN_TIMEOUT_MS = 180_000;

export interface PluginPlan {
  id: HostId;
  name: string;
  binary?: string;
  configHome: string;
  installed: boolean;
  commands: string[][];
  manual: string;
  error?: string;
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function pluginState(configHome: string): { installed: boolean; marketplace: boolean } {
  const plugins = join(configHome, "plugins");
  const known = readJson(join(plugins, "known_marketplaces.json")) ?? {};
  const list = (readJson(join(plugins, "installed_plugins.json"))?.plugins ?? {}) as Record<string, unknown>;
  const entries = list[CLAUDE_PLUGIN];
  // A project-scoped install elsewhere does not cover this user's other projects.
  const user = Array.isArray(entries) && entries.some((entry) => entry?.scope === "user");
  return { installed: user, marketplace: CLAUDE_MARKETPLACE in known };
}

function unreadable(name: string, error: unknown): string {
  return `cannot read ${name}'s plugin state: ${String((error as Error).message)
    .split("\n")[0]
    .slice(0, 200)}`;
}

// Only Claude Code takes the plugin: other marketplaces accept it but would also get codex-pair's hooks (ADR-183).
export function planPlugins(hosts: DetectedHost[], selected: HostId[] | undefined): PluginPlan[] {
  const plans: PluginPlan[] = [];
  for (const { id, name, installed, binary, spec } of hosts) {
    if (!installed || (selected && !selected.includes(id)) || !spec.pluginInstall) continue;
    const plan: PluginPlan = {
      id,
      name,
      binary,
      configHome: spec.configHome,
      installed: false,
      commands: spec.pluginInstall,
      manual: spec.pluginInstall.map(commandText).join(" && "),
    };
    try {
      const state = pluginState(spec.configHome);
      plan.installed = state.installed;
      if (state.installed) plan.commands = [];
      else if (state.marketplace) plan.commands = plan.commands.filter((argv) => !argv.includes("marketplace"));
    } catch (error) {
      plan.error = unreadable(name, error);
    }
    plans.push(plan);
  }
  return plans;
}

export async function installPlugins(
  plans: PluginPlan[],
  confirm: Confirm,
  env: NodeJS.ProcessEnv,
): Promise<WorkflowResult[]> {
  const results: WorkflowResult[] = [];
  for (const plan of plans) {
    const { id, name, manual } = plan;
    const result = (status: WorkflowStatus, extra: Partial<WorkflowResult> = {}) =>
      results.push({ id, name, label: `${name} plugin`, status, ...extra });
    if (plan.error || !plan.binary) {
      result("manual", { detail: plan.error ?? `${name} was not found on PATH`, manual });
      continue;
    }
    if (plan.installed) {
      result("up-to-date");
      continue;
    }
    const runs = plan.commands.map(commandText).join(" && ");
    if (!(await confirm(`Install the Ask LLM plugin in ${name}? Runs: ${runs}`))) {
      result("declined");
      continue;
    }
    let backup: string | undefined;
    try {
      backup = backupConfig(join(plan.configHome, "settings.json"));
    } catch (error) {
      result("failed", { detail: `cannot back up ${name}'s settings.json: ${(error as Error).message}`, manual });
      continue;
    }
    let failure: string | undefined;
    for (const argv of plan.commands) {
      const run = await runHost(plan.binary, argv.slice(1), env, PLUGIN_TIMEOUT_MS);
      if (run.code !== 0) {
        failure = `${firstLine(`${run.stderr}\n${run.stdout}`) || "no output"} (exit ${run.code ?? "timeout or signal"})`;
        break;
      }
    }
    if (!failure) {
      try {
        if (!pluginState(plan.configHome).installed)
          failure = `${CLAUDE_PLUGIN} is not listed as installed after ${runs}`;
      } catch (error) {
        failure = unreadable(name, error);
      }
    }
    if (failure) result("failed", { detail: failure, manual, backup });
    else result("installed", { backup });
  }
  return results;
}
