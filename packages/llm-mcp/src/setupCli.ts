import { detectHosts } from "./hosts/detect.js";
import { buildPlan, genericSnippet, type PlanEntry, resolveServerPath, type ServerPath } from "./plan.js";

export function setupHelp(): string {
  return [
    "Usage: ask-llm setup --dry-run [--json]",
    "",
    "Detect coding-agent hosts and preview the exact command or file each would use",
    "to register Ask LLM. This release only previews: nothing is written.",
    "",
    "Options:",
    "  --dry-run     Required. Preview only",
    "  --json        Print the plan as JSON",
    "  -h, --help    Show this help",
    "",
  ].join("\n");
}

function refuse(message: string): number {
  process.stderr.write(`Error: ${message}\n\n${setupHelp()}`);
  return 2;
}

function formatEntry(entry: PlanEntry): string[] {
  const version = entry.version ? ` ${entry.version}` : "";
  const lines = [`  ${entry.name}${version}: ${entry.action}${entry.reason ? ` (${entry.reason})` : ""}`];
  if (entry.action !== "register" && entry.action !== "manual") return lines;
  const { registration } = entry;
  lines.push(
    registration.kind === "command"
      ? `      ${registration.command}`
      : `      merge ${JSON.stringify(registration.entry)} at ${registration.keyPath.join(".")} in ${registration.file}`,
  );
  return lines;
}

function formatText(server: ServerPath, plan: PlanEntry[]): string {
  return [
    "ask-llm setup --dry-run: preview only, nothing was changed.",
    `Server: ${server.path} (${server.source})`,
    "",
    "Hosts:",
    ...plan.flatMap(formatEntry),
    "",
    "Any other MCP client (stdio):",
    `  ${JSON.stringify(genericSnippet(server.path))}`,
    "",
  ].join("\n");
}

export async function runSetupCli(args: string[], ownCli: string): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(setupHelp());
    return 0;
  }
  const unknown = args.find((arg) => arg !== "--dry-run" && arg !== "--json");
  if (unknown !== undefined) return refuse(`unsupported setup argument: ${unknown}`);
  if (!args.includes("--dry-run")) {
    return refuse("this release can only preview registration; nothing was changed. Run ask-llm setup --dry-run.");
  }

  let server: ServerPath;
  try {
    server = await resolveServerPath(ownCli);
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const plan = buildPlan(await detectHosts(), server.path);
  process.stdout.write(
    args.includes("--json")
      ? `${JSON.stringify(
          {
            schema: "ask-llm.setup-plan",
            schemaVersion: 1,
            dryRun: true,
            server,
            hosts: plan,
            otherClients: { snippet: genericSnippet(server.path) },
          },
          null,
          2,
        )}\n`
      : formatText(server, plan),
  );
  return 0;
}
