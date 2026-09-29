import { createInterface } from "node:readline/promises";
import { detectHosts } from "./hosts/detect.js";
import { type HostId, hostSpecs } from "./hosts/registry.js";
import { buildPlan, genericSnippet, type PlanEntry, resolveServerPath, type ServerPath } from "./plan.js";
import { installPlugins, type PluginPlan, planPlugins } from "./plugins.js";
import { applyRemove } from "./remove.js";
import { applySetup, type Confirm, type HostResult, type HostStatus, UNSUCCESSFUL } from "./setup.js";
import { installSkills, planSkills, type SkillsPlan, type WorkflowResult } from "./skills.js";

const HOST_IDS = hostSpecs().map(({ id }) => id);

export function setupHelp(): string {
  return [
    "Usage: ask-llm setup [-y] [--host <ids>] | ask-llm setup --dry-run [--json] [--host <ids>]",
    "",
    "Detect coding-agent hosts, preview the exact command or file change for each, and",
    "register Ask LLM at user scope in each confirmed host: through the host's own command",
    "for Claude Code, Codex, Antigravity, Grok Build and Gemini CLI, and by merging one entry",
    "into the config file of Cursor, Claude Desktop and OpenCode (plain JSON only). Other",
    "hosts get the manual step. Existing ask-llm entries are never overwritten; re-running",
    "changes nothing.",
    "",
    "Setup also installs the workflows: the Ask LLM plugin in Claude Code through its",
    "marketplace, and the ask-llm-* skills for every other selected host through the pinned",
    "skills CLI (npx), one mechanism per host.",
    "",
    "Options:",
    "  --dry-run      Preview only; nothing is written",
    "  --json         Print the preview as JSON (with --dry-run)",
    "  -y, --yes      Register without asking (for scripts)",
    `  --host <ids>   Only these hosts, comma-separated: ${HOST_IDS.join(",")}`,
    "  -h, --help     Show this help",
    "",
  ].join("\n");
}

export function removeHelp(): string {
  return [
    "Usage: ask-llm remove [-y] [--host <ids>]",
    "",
    "Remove the ask-llm entries that run this ask-llm-mcp, through each host's own command",
    "or from its config file.",
    "Entries that run anything else are left in place.",
    "",
    "Options:",
    "  -y, --yes      Remove without asking (for scripts)",
    `  --host <ids>   Only these hosts, comma-separated: ${HOST_IDS.join(",")}`,
    "  -h, --help     Show this help",
    "",
  ].join("\n");
}

interface Options {
  dryRun: boolean;
  json: boolean;
  yes: boolean;
  hosts?: HostId[];
}

function parseArgs(args: string[], command: string, previewFlags: boolean): Options | string {
  const options: Options = { dryRun: false, json: false, yes: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-y" || arg === "--yes") options.yes = true;
    else if (previewFlags && arg === "--dry-run") options.dryRun = true;
    else if (previewFlags && arg === "--json") options.json = true;
    else if (arg === "--host" || arg.startsWith("--host=")) {
      const value = arg === "--host" ? args[++index] : arg.slice("--host=".length);
      if (!value || value.startsWith("-")) return "--host needs a comma-separated list of hosts";
      const ids = value.split(",").map((id) => id.trim());
      const unknown = ids.find((id) => !HOST_IDS.includes(id as HostId));
      if (unknown !== undefined) return `unknown host: ${unknown} (known: ${HOST_IDS.join(", ")})`;
      options.hosts = [...(options.hosts ?? []), ...(ids as HostId[])];
    } else return `unsupported ${command} argument: ${arg}`;
  }
  return options;
}

function refuse(message: string, help: string): number {
  process.stderr.write(`Error: ${message}\n\n${help}`);
  return 2;
}

function formatEntry(entry: PlanEntry): string[] {
  const version = entry.version ? ` ${entry.version}` : "";
  const lines = [`  ${entry.name}${version}: ${entry.action}${entry.reason ? ` (${entry.reason})` : ""}`];
  const { registration } = entry;
  lines.push(
    registration.kind === "command"
      ? `      ${registration.command}`
      : `      merge ${JSON.stringify(registration.entry)} at ${registration.keyPath.join(".")} in ${registration.file}`,
  );
  return lines;
}

interface Workflows {
  plugins: PluginPlan[];
  skills: SkillsPlan;
}

function formatWorkflows({ plugins, skills }: Workflows): string[] {
  const lines = ["Workflows:"];
  for (const plugin of plugins) {
    const runs = plugin.commands.map((argv) => argv.join(" ")).join(" && ");
    lines.push(
      `  ${plugin.name} plugin: ${plugin.error ?? (plugin.installed ? "already installed" : "install")}`,
      ...(plugin.installed || plugin.error ? [] : [`      ${runs}`]),
    );
  }
  if (skills.command) {
    lines.push(`  Skills for ${skills.agents.map(({ name }) => name).join(", ")}: install`, `      ${skills.command}`);
  }
  for (const { name } of skills.upToDate) lines.push(`  ${name} skills: already installed`);
  for (const { name, command } of skills.manual) lines.push(`  ${name} skills: manual`, `      ${command}`);
  if (lines.length === 1) lines.push("  none for the selected hosts");
  return [...lines, ""];
}

function formatPreview(heading: string, server: ServerPath, plan: PlanEntry[], workflows: Workflows): string {
  return [
    heading,
    `Server: ${server.path} (${server.source})`,
    "",
    "Hosts:",
    ...plan.flatMap(formatEntry),
    "",
    ...formatWorkflows(workflows),
    "Any other MCP client (stdio):",
    `  ${JSON.stringify(genericSnippet(server.path))}`,
    "",
  ].join("\n");
}

const REMOVE_WORKFLOWS_NOTE =
  "Workflows are left installed. To remove them: `claude plugin uninstall ask-llm@ask-llm-plugins` and `npx -y skills remove -g -y <ask-llm-* skill names>`.";

const REFORMAT_NOTICE =
  "The host's own command may reformat its config file, and a JSON file setup edits is rewritten with its indentation kept; unrelated entries keep their meaning. Each backup may contain credentials, stays next to the original with the same permissions, and remains until you delete it.";

const LABELS: Record<HostStatus, string> = {
  registered: "registered",
  "up-to-date": "already registered",
  removed: "removed",
  "not-registered": "not registered",
  declined: "declined",
  skipped: "skipped",
  conflict: "conflict",
  "not-owned": "not removed",
  manual: "manual",
  unsupported: "not handled by this release",
  failed: "failed",
};

function formatResult(result: HostResult): string[] {
  const version = result.version ? ` ${result.version}` : "";
  const lines = [`  ${result.name}${version}: ${LABELS[result.status]}${result.detail ? ` (${result.detail})` : ""}`];
  if (result.next) lines.push(`      Next: ${result.next}`);
  if (result.backup) lines.push(`      Backup: ${result.backup}`);
  if (result.manual)
    lines.push(
      result.status === "conflict"
        ? `      Entry for this install (not written): ${result.manual}`
        : `      Run it manually: ${result.manual}`,
    );
  return lines;
}

function formatWorkflow(result: WorkflowResult): string[] {
  const lines = [
    `  ${result.label}: ${result.status === "up-to-date" ? "already installed" : result.status}${result.detail ? ` (${result.detail})` : ""}`,
  ];
  if (result.backup) lines.push(`      Backup: ${result.backup}`);
  if (result.manual) lines.push(`      Run it manually: ${result.manual}`);
  return lines;
}

function report(results: HostResult[], changed: HostStatus, workflows: WorkflowResult[] = []): number {
  const lines = ["Results:", ...results.flatMap(formatResult)];
  if (results.length === 0) lines.push("  No supported host is installed; pass --host to name one.");
  if (workflows.length > 0) lines.push("", "Workflows:", ...workflows.flatMap(formatWorkflow));
  const workflowChanged = workflows.some(({ status }) => status === "installed");
  if (!results.some(({ status }) => status === changed) && !workflowChanged) lines.push("No changes.");
  process.stdout.write(`${lines.join("\n")}\n`);
  const workflowFailed = workflows.some(({ status }) => status === "manual" || status === "failed");
  return results.some(({ status }) => UNSUCCESSFUL.has(status)) || workflowFailed ? 1 : 0;
}

async function withConfirm<T>(yes: boolean, run: (confirm: Confirm) => Promise<T>): Promise<T> {
  if (yes) return run(async () => true);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await run(async (question) => /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim()));
  } finally {
    prompt.close();
  }
}

async function serverPath(ownCli: string): Promise<ServerPath | undefined> {
  try {
    return await resolveServerPath(ownCli);
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return undefined;
  }
}

function needsTerminal(options: Options): boolean {
  return !options.dryRun && !options.yes && !process.stdin.isTTY;
}

export async function runSetupCli(args: string[], ownCli: string): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(setupHelp());
    return 0;
  }
  const options = parseArgs(args, "setup", true);
  if (typeof options === "string") return refuse(options, setupHelp());
  if (options.json && !options.dryRun) return refuse("--json is only available with --dry-run", setupHelp());
  if (needsTerminal(options)) {
    return refuse("no terminal to confirm each host; pass -y to register without asking", setupHelp());
  }

  const server = await serverPath(ownCli);
  if (!server) return 1;
  if (!options.dryRun && server.source !== "global-bin") {
    process.stderr.write(
      "Error: setup requires a durable ask-llm-mcp bin. Install with `npm i -g @ask-llm/mcp`, then rerun `ask-llm setup`.\n",
    );
    return 1;
  }
  const hosts = await detectHosts();
  const shown = buildPlan(hosts, server.path).filter(({ id }) => !options.hosts || options.hosts.includes(id));
  const workflows: Workflows = { plugins: planPlugins(hosts, options.hosts), skills: planSkills(hosts, options.hosts) };
  if (options.dryRun) {
    process.stdout.write(
      options.json
        ? `${JSON.stringify(
            {
              schema: "ask-llm.setup-plan",
              schemaVersion: 1,
              dryRun: true,
              server,
              hosts: shown,
              workflows: {
                plugins: workflows.plugins.map(({ binary: _binary, ...plugin }) => plugin),
                skills: workflows.skills,
              },
              otherClients: { snippet: genericSnippet(server.path) },
            },
            null,
            2,
          )}\n`
        : formatPreview("ask-llm setup --dry-run: preview only, nothing was changed.", server, shown, workflows),
    );
    return 0;
  }

  process.stdout.write(
    formatPreview(
      `ask-llm setup: each change runs the host's own command or merges one entry into its file.\n${REFORMAT_NOTICE}`,
      server,
      shown,
      workflows,
    ),
  );
  const [results, installed] = await withConfirm(options.yes, async (confirm) => [
    await applySetup(hosts, server.path, options.hosts, confirm, process.env),
    [
      ...(await installPlugins(workflows.plugins, confirm, process.env)),
      ...(await installSkills(workflows.skills, confirm, process.env)),
    ],
  ]);
  return report(results, "registered", installed);
}

export async function runRemoveCli(args: string[], ownCli: string): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(removeHelp());
    return 0;
  }
  const options = parseArgs(args, "remove", false);
  if (typeof options === "string") return refuse(options, removeHelp());
  if (needsTerminal(options)) {
    return refuse("no terminal to confirm each host; pass -y to remove without asking", removeHelp());
  }

  const server = await serverPath(ownCli);
  if (!server) return 1;
  process.stdout.write(
    `ask-llm remove: only ask-llm entries that run ${server.path} are removed.\n${REFORMAT_NOTICE}\n`,
  );
  const hosts = await detectHosts();
  const results = await withConfirm(options.yes, (confirm) =>
    applyRemove(hosts, server.path, options.hosts, confirm, process.env),
  );
  process.stdout.write(`${REMOVE_WORKFLOWS_NOTE}\n`);
  return report(results, "removed");
}
