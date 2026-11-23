import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { runCommand } from "./harness-smoke-lib.ts";

interface Invocation {
  command: string;
  args: string[];
}

interface ToolResult {
  text: string;
  structured?: Record<string, unknown>;
}

interface Tool {
  name: string;
  schema: { properties?: Record<string, unknown> };
  call: (args: Record<string, unknown>) => Promise<ToolResult>;
}

interface SmokeOptions {
  root: string;
  work: string;
  model: string;
  marker: string;
  livePrompt: string;
  invocations: () => Promise<Invocation[]>;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function connect(args: string[], cwd: string, env: Record<string, string>) {
  const client = new Client({ name: "solo-brainstorm-fixture", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args, cwd, env, stderr: "ignore" }));
  return client;
}

async function mcpTool(client: Client, name: string): Promise<Tool> {
  const tool = (await client.listTools()).tools.find((entry) => entry.name === name);
  check(tool, `MCP did not advertise ${name}`);
  return {
    name,
    schema: tool.inputSchema,
    async call(args) {
      const result = await client.callTool({ name, arguments: args });
      const text = result.content.flatMap((entry) => (entry.type === "text" ? [entry.text] : [])).join("\n");
      if (result.isError) throw new Error(text);
      const structured = result.structuredContent as Record<string, unknown> | undefined;
      return { text, structured };
    },
  };
}

async function installFixtures(plugin: string, work: string, env: NodeJS.ProcessEnv) {
  const packed = join(work, "packed");
  const marketplace = join(work, "marketplace");
  const serverCache = join(work, "server-cache");
  await mkdir(packed);
  await mkdir(join(marketplace, "scripts"), { recursive: true });
  for (const file of ["package.json", ".mcp.json", "scripts/plugin-mcp-server.mjs"]) {
    await cp(join(plugin, file), join(marketplace, file));
  }
  await cp(join(plugin, "skills", "ask-llm-brainstorm"), join(marketplace, "skills", "ask-llm-brainstorm"), {
    recursive: true,
  });
  const archive = await runCommand(
    "npm",
    ["pack", "--offline", "--ignore-scripts", "--pack-destination", work, plugin],
    {
      env: { ...env, npm_config_cache: join(work, "npm-cache") },
    },
  );
  check(archive.exitCode === 0, `offline npm pack failed: ${archive.stderr.slice(-800)}`);
  const unpack = await runCommand("tar", [
    "-xf",
    join(work, archive.stdout.trim()),
    "--strip-components=1",
    "-C",
    packed,
  ]);
  check(unpack.exitCode === 0, "could not unpack the local npm archive");
  await symlink(resolve(plugin, "../../node_modules"), join(packed, "node_modules"), "dir");

  const { mcpServers } = JSON.parse(await readFile(join(marketplace, ".mcp.json"), "utf8")) as {
    mcpServers: { codex: { command: string; args: string[] } };
  };
  const args = mcpServers.codex.args.map((arg) => arg.replace(/^\$\{CLAUDE_PLUGIN_ROOT\}/, marketplace));
  const version = args[2];
  const cacheParent = join(serverCache, `mcp@${version}`, "node_modules", "@ask-llm");
  await mkdir(cacheParent, { recursive: true });
  await symlink(packed, join(cacheParent, "mcp"), "dir");
  return { marketplace, args, packed, serverCache };
}

async function nativeTools(): Promise<Map<string, Tool>> {
  const { registerProviderTools } = await import("../packages/llm-mcp/pi/extensions/provider-tools.js");
  const tools = new Map<string, Tool>();
  await registerProviderTools({
    registerTool(tool: {
      name: string;
      parameters: Tool["schema"];
      execute: (
        id: string,
        args: Record<string, unknown>,
      ) => Promise<{
        content: { text: string }[];
        details: { structuredContent?: Record<string, unknown> };
      }>;
    }) {
      tools.set(tool.name, {
        name: tool.name,
        schema: tool.parameters,
        async call(args) {
          const result = await tool.execute("fixture", args);
          return {
            text: result.content.map(({ text }) => text).join("\n"),
            structured: result.details.structuredContent ?? result.details,
          };
        },
      });
    },
  } as never);
  return tools;
}

// This driver models the skill's routing choices over real tool discovery and adapters.
// Host interpretation of the Markdown requires a separate, authorized host session.
async function consult(
  specs: string,
  prompt: string,
  tools: Tool[],
  call: (tool: Tool, args: Record<string, unknown>) => Promise<ToolResult>,
  cli?: (model: string, prompt: string) => Promise<ToolResult>,
) {
  const model = /^codex@codex-cli:([A-Za-z0-9][A-Za-z0-9._:/-]*)$/.exec(specs)?.[1];
  check(model && model.toLowerCase() !== "auto", "expected one exact non-Auto Codex CLI participant");
  const pins = { prompt, model, reasoningEffort: "high", sandbox: "read-only", noFallback: true };
  const split = tools.find(({ name }) => name === "ask-codex");
  const unified = tools.find(({ name }) => name === "ask-llm");
  const fields = Object.keys(pins);
  const has = (tool: Tool, required: string[]) =>
    required.every((name) => Object.hasOwn(tool.schema.properties ?? {}, name));
  let result: ToolResult;
  if (split && has(split, fields)) {
    result = await call(split, pins);
  } else if (unified && has(unified, [...fields, "provider", "preferred", "includeDirs"])) {
    result = await call(unified, { ...pins, provider: "codex", preferred: false, includeDirs: [] });
  } else {
    check(!split && !unified, "stale schema requires upgrade and restart");
    check(cli, "no capable native tool");
    result = await cli(model, prompt);
  }
  const attribution = `Codex CLI · selected ${model} · reasoning effort configured high`;
  check(result.text.startsWith(`${attribution}\n`), "unexpected selected model or configured effort");
  if (result.structured) {
    const { model: selected, reasoningEffort, response, usage } = result.structured;
    check(selected === model && reasoningEffort === "high", "strict tool returned mismatched attribution");
    check((usage as { fellBack?: boolean } | undefined)?.fellBack !== true, "strict tool reported a fallback");
    check(typeof response === "string" && response.trim(), "strict tool returned an empty answer");
  }
  check(!/^#+ .*consensus/im.test(result.text), "solo result included a consensus section");
  return result;
}

export async function runSoloBrainstorm(options: SmokeOptions) {
  const { root, work, model, marker, livePrompt, invocations } = options;
  const plugin = join(root, "packages", "llm-mcp");
  const env = {
    PATH: process.env.PATH as string,
    ASK_LLM_PATH: process.env.ASK_LLM_PATH as string,
    ASK_LLM_SMOKE_INVOCATIONS: process.env.ASK_LLM_SMOKE_INVOCATIONS as string,
    ASK_LLM_SMOKE_MARKER: marker,
    HOME: work,
    OLLAMA_HOST: "http://127.0.0.1:9",
    ASK_GROK_HARNESS: "grok-cli",
    ASK_CODEX_REASONING_EFFORT: "xhigh",
  };
  process.env.ASK_CODEX_REASONING_EFFORT = env.ASK_CODEX_REASONING_EFFORT;
  process.env.OLLAMA_HOST = env.OLLAMA_HOST;
  process.env.ASK_GROK_HARNESS = env.ASK_GROK_HARNESS;
  delete process.env.ASK_CODEX_LOAD_USER_CONFIG;
  const { marketplace, args, packed, serverCache } = await installFixtures(plugin, work, env);
  const splitClient = await connect(args, work, {
    ...env,
    ASK_CODEX_PREFERRED_MODEL: model,
    ASK_LLM_SERVER_CACHE: serverCache,
    ASK_LLM_SERVER_NPM: join(work, "disabled-npm"),
  });
  const unifiedClient = await connect([join(packed, "dist", "cli.js")], work, env);
  try {
    const split = await mcpTool(splitClient, "ask-codex");
    const unified = await mcpTool(unifiedClient, "ask-llm");
    const pi = await nativeTools();
    const native = pi.get("ask-llm");
    const alias = pi.get("ask-codex");
    check(native && alias, "native Pi Codex tools were unavailable");
    check(
      !Object.hasOwn((await mcpTool(splitClient, "ask-codex-write")).schema.properties ?? {}, "noFallback"),
      "workspace-write unexpectedly advertised noFallback",
    );
    const stale = (tool: Tool): Tool => {
      const { noFallback: _omitted, ...properties } = tool.schema.properties ?? {};
      return { ...tool, schema: { properties } };
    };
    const disconnected = {
      ...split,
      async call() {
        throw new Error("tool disconnected");
      },
    };
    const disconnectedAfterSpawn = {
      ...split,
      async call(params: Record<string, unknown>) {
        await split.call(params);
        throw new Error("tool disconnected after dispatch");
      },
    };
    const runCli = (path: string) => async (pin: string, prompt: string) => {
      const result = await runCommand(
        "/bin/bash",
        [join(packed, "skills", "ask-llm-brainstorm", "codex-strict.sh"), pin, "high"],
        { cwd: work, stdin: prompt, env: { ...env, PATH: path } },
      );
      if (result.exitCode !== 0 || result.timedOut) throw new Error(result.stderr);
      return { text: result.stdout };
    };
    const cli = runCli(env.PATH);
    const spec = /\/brainstorm --external-only --no-fallback (\S+)/.exec(livePrompt)?.[1];
    check(spec === `codex@codex-cli:${model}`, "solo fixture lost the slash invocation");
    const lateQuota = "\n[smoke: terminal quota]";
    const transient = "\n[smoke: transient error]";
    const matrix = [
      { id: "marketplace", tools: [split], calls: 1, execs: 1, rung: "ask-codex" },
      { id: "portable", tools: [unified], calls: 1, execs: 1, rung: "ask-llm" },
      { id: "pi-native", tools: [native], calls: 1, execs: 1, rung: "ask-llm" },
      { id: "pi-alias", tools: [alias], calls: 1, execs: 1, rung: "ask-codex" },
      { id: "stale-split", tools: [stale(split), unified], calls: 1, execs: 1, rung: "ask-llm" },
      { id: "cli-only", tools: [], cli, calls: 0, execs: 1, suffix: transient },
      { id: "cli-quota", tools: [], cli, calls: 0, execs: 1, suffix: lateQuota, error: "insufficient_quota" },
      {
        id: "invalid-model",
        tools: [split],
        calls: 0,
        execs: 0,
        spec: "codex@codex-cli:Auto",
        error: "exact non-Auto",
      },
      { id: "empty-model", tools: [split], calls: 0, execs: 0, spec: "codex@codex-cli:", error: "exact non-Auto" },
      { id: "multiple", tools: [split], calls: 0, execs: 0, spec: `${spec},${spec}`, error: "exact non-Auto" },
      {
        id: "wrong-route",
        tools: [split],
        calls: 0,
        execs: 0,
        spec: "codex@cursor-agent:gpt-6.2-astra",
        error: "exact non-Auto",
      },
      { id: "stale-only", tools: [stale(split)], cli, calls: 0, execs: 0, error: "stale schema" },
      { id: "stale-pi", tools: [stale(native)], calls: 0, execs: 0, error: "stale schema" },
      {
        id: "split-quota",
        tools: [split, unified],
        calls: 1,
        execs: 1,
        suffix: lateQuota,
        error: "insufficient_quota",
      },
      { id: "unified-quota", tools: [unified], calls: 1, execs: 1, suffix: lateQuota, error: "insufficient_quota" },
      { id: "pi-quota", tools: [native], calls: 1, execs: 1, suffix: lateQuota, error: "insufficient_quota" },
      {
        id: "nonzero-quota",
        tools: [split, unified],
        calls: 1,
        execs: 1,
        suffix: "\n[smoke: nonzero terminal quota]",
        error: "insufficient_quota",
      },
      { id: "disconnected", tools: [disconnected, unified], cli, calls: 1, execs: 0, error: "disconnected" },
      {
        id: "late-disconnect",
        tools: [disconnectedAfterSpawn, unified],
        cli,
        calls: 1,
        execs: 1,
        error: "disconnected",
      },
      {
        id: "no-binary",
        tools: [],
        cli: runCli(join(work, "empty-path")),
        calls: 0,
        execs: 0,
        error: "unavailable on PATH",
      },
    ];
    const counts = [];
    const initial = (await invocations()).length;
    for (const entry of matrix) {
      const countBefore = (await invocations()).length;
      const calls: string[] = [];
      const result = await consult(
        entry.spec ?? spec,
        `${livePrompt}\nfixture=${entry.id}${entry.suffix ?? ""}`,
        entry.tools,
        (tool, params) => {
          calls.push(tool.name);
          return tool.call(params);
        },
        entry.cli,
      ).then(
        (value) => ({ value }),
        (error: Error) => ({ error: error.message }),
      );
      if (entry.error)
        check(
          "error" in result && result.error?.includes(entry.error) && !result.error.includes(marker),
          `${entry.id} did not report the expected failure cleanly: ${"error" in result ? result.error : "returned an answer"}`,
        );
      else
        check("value" in result && result.value.text.includes(marker), `${entry.id} did not return the fixture answer`);
      const execs = (await invocations()).slice(countBefore).filter(({ args }) => args[0] === "exec");
      check(calls.length === entry.calls && execs.length === entry.execs, `${entry.id} violated dispatch counts`);
      if (entry.rung) check(calls[0] === entry.rung, `${entry.id} chose the wrong provider tool`);
      for (const invocation of execs) {
        const { command, args } = invocation;
        check(
          command === "codex" &&
            args[args.indexOf("-m") + 1] === model &&
            args.includes('model_reasoning_effort="high"') &&
            args.includes("--ephemeral") &&
            args.includes("read-only") &&
            args.includes("--json") &&
            args.includes("--ignore-user-config") &&
            args.includes("--ignore-rules"),
          `${entry.id} lost the isolated Astra/high pin`,
        );
      }
      counts.push(`${entry.id}:${calls.length}/${execs.length}`);
    }
    const trace = (await invocations()).slice(initial);
    check(
      trace.every(({ command }) => command === "codex"),
      "solo run launched a different provider",
    );
    await verifyOrdinaryCodexResults(split, model, invocations);
    await verifyPanelRegressions({ plugin, marketplace, packed, work, marker, env, unifiedClient, pi, invocations });
    return { counts, trace, attribution: `Codex CLI · selected ${model} · reasoning effort configured high` };
  } finally {
    await Promise.all([splitClient.close(), unifiedClient.close()]);
  }
}

async function verifyOrdinaryCodexResults(split: Tool, model: string, invocations: SmokeOptions["invocations"]) {
  const preferred = await split.call({ prompt: "Review a sample with preferred Codex", preferred: true });
  check(
    preferred.structured?.model === model && preferred.structured.reasoningEffort === "xhigh",
    "preferred tool result lost the selected model and configured effort",
  );
  check(
    preferred.text.startsWith(`Codex CLI · selected ${model} · reasoning effort configured xhigh\n`),
    "preferred tool text lost attribution",
  );

  const fallback = await split.call({
    prompt: "Review a sample [smoke: quota primary]",
    model,
    reasoningEffort: "high",
  });
  check(
    fallback.structured?.model === "gpt-6.1-terra" && fallback.structured.reasoningEffort === "high",
    "quota fallback tool result lost attribution",
  );
  check(
    fallback.text.startsWith("Codex CLI · selected gpt-6.1-terra · reasoning effort configured high · fallback\n"),
    "quota fallback tool text lost attribution",
  );

  const primaryArgs = { prompt: "Review a sample with a cacheable answer", model, reasoningEffort: "high" };
  const primary = await split.call(primaryArgs);
  const before = (await invocations()).length;
  const cached = await split.call(primaryArgs);
  check(
    cached.text.startsWith(`Codex CLI · selected ${model} · reasoning effort configured high · cached\n`),
    "cache-hit text lost its original configuration",
  );
  check(
    cached.structured?.model === model &&
      cached.structured.reasoningEffort === "high" &&
      cached.structured.response === primary.structured?.response &&
      cached.structured.usage === undefined,
    "cache-hit structured response lost attribution or reports fresh usage",
  );
  check((await invocations()).length === before, "ordinary tool bypassed its warm response cache");
}

async function verifyPanelRegressions({
  plugin,
  marketplace,
  packed,
  work,
  marker,
  env,
  unifiedClient,
  pi,
  invocations,
}: {
  plugin: string;
  marketplace: string;
  packed: string;
  work: string;
  marker: string;
  env: Record<string, string>;
  unifiedClient: Client;
  pi: Map<string, Tool>;
  invocations: SmokeOptions["invocations"];
}) {
  const multi = await mcpTool(unifiedClient, "multi-llm");
  const nativeMulti = pi.get("multi-llm");
  const nativeAlias = pi.get("ask-multi");
  check(nativeMulti && nativeAlias, "Pi batch tools were unavailable");
  for (const tool of [multi, nativeMulti, nativeAlias]) {
    const result = await tool.call({
      prompt: `Review a sample queue with ${tool.name}`,
      providers: ["codex", "gemini"],
    });
    const results = result.structured?.results as { provider: string; reasoningEffort?: string }[] | undefined;
    check(results?.map(({ provider }) => provider).join(",") === "codex,gemini", `${tool.name} changed batch order`);
    const effort = "xhigh";
    check(
      result.text.includes(`reasoning effort configured ${effort}`) && result.text.includes(marker),
      `${tool.name} omitted configured Codex effort`,
    );
    if (tool !== nativeAlias) {
      check(
        results[0].reasoningEffort === effort && results[1].reasoningEffort === undefined,
        `${tool.name} did not preserve Codex-only effort in structured output`,
      );
    }
  }

  const allProviders = ["gemini", "codex", "grok", "ollama", "antigravity"];
  const providerField = multi.schema.properties?.providers as { items: { enum: string[] } };
  const available = allProviders.filter((provider) => providerField.items.enum.includes(provider));
  const unavailable = allProviders.filter((provider) => !available.includes(provider));
  const all = await multi.call({
    prompt: "Review the sample queue with all available providers",
    providers: available,
  });
  const allResults = all.structured?.results as { provider: string; ok: boolean }[];
  check(
    unavailable.join(",") === "ollama,antigravity" &&
      allResults.map(({ provider }) => provider).join(",") === "gemini,codex,grok" &&
      allResults.every(({ ok }) => ok),
    "the portable brainstorm-all bare list lost a supported route or included an unavailable one",
  );

  const coordinator = await readFile(join(plugin, "agents", "brainstorm-coordinator.md"), "utf8");
  const codexJob = /^codex_no_fallback=0[^]*?^pid_codex=\$!$/m.exec(coordinator)?.[0];
  check(codexJob, "coordinator Bash template lost the Codex job");
  const scenarioDir = join(work, "coordinator");
  await mkdir(scenarioDir);
  await writeFile(join(scenarioDir, "prompt.md"), "Review a sample queue");
  const runLegacy = async (strict: boolean, overrides: Record<string, string>, expected: string[]) => {
    const before = (await invocations()).length;
    const program = strict ? codexJob.replace("codex_no_fallback=0", "codex_no_fallback=1") : codexJob;
    const result = await runCommand(
      "/bin/bash",
      ["-c", `workdir=$1\n${program}\nwait "$pid_codex"`, "fixture", scenarioDir],
      {
        cwd: work,
        env: { ...env, ASK_CODEX_REASONING_EFFORT: "invalid", CLAUDE_PLUGIN_ROOT: marketplace, ...overrides },
      },
    );
    const execs = (await invocations()).slice(before).filter(({ args }) => args[0] === "exec");
    check(
      execs.map(({ args }) => args[args.indexOf("-m") + 1]).join(",") === expected.join(","),
      "standard coordinator selected unexpected Codex attempts",
    );
    const attempts = await readFile(join(scenarioDir, "codex.attempts"), "utf8");
    check(
      attempts.includes(`selected ${expected.at(-1)} · reasoning effort configured high`),
      "raw coordinator lost attribution",
    );
    return result.exitCode;
  };
  check((await runLegacy(false, {}, ["gpt-6.2-sol"])) === 0, "default coordinator failed");
  const preferred = {
    ASK_CODEX_PREFERRED_MODEL: "gpt-6.2-astra",
    ASK_CODEX_MODEL: "env-default",
    ASK_LLM_SMOKE_RAW_PRIMARY_ERROR: "1",
  };
  check(
    (await runLegacy(false, preferred, ["gpt-6.2-astra", "gpt-6.1-terra"])) === 0,
    "default coordinator did not retry",
  );
  check(
    (await runLegacy(true, preferred, ["gpt-6.2-astra"])) === 42,
    "strict coordinator did not preserve the exit status",
  );
  check(
    (await readFile(join(scenarioDir, "codex.err"), "utf8")).includes("fixture authentication failure"),
    "strict coordinator did not retain the original stderr",
  );
  check((await readFile(join(scenarioDir, "codex.out"), "utf8")) === "", "strict coordinator returned a failed answer");

  const before = (await invocations()).length;
  const pair = await runCommand(
    process.execPath,
    [
      join(packed, "dist", "brainstorm-run.js"),
      "--no-fallback",
      "--participant",
      "grok@grok-cli:grok-4.7",
      "--participant",
      "codex@codex-cli:gpt-6.2-sol",
    ],
    {
      cwd: work,
      env,
      stdin: "Review a sample queue\n[smoke: terminal quota]",
    },
  );
  check(pair.exitCode === 2, "the exact runner failed to report a partial panel");
  const report = JSON.parse(pair.stdout);
  check(
    report.status === "partial" && !report.consensusEligible && report.participants.length === 2,
    `expected a partial pair: ${report.participants.map(({ error }: { error?: string }) => error ?? "fulfilled").join("; ")}`,
  );
  check(
    report.participants[1].error?.includes("insufficient_quota") && !report.participants[1].response,
    "the exact runner surfaced a failed intermediate answer",
  );
  const codexExecs = (await invocations())
    .slice(before)
    .filter(({ command, args }) => command === "codex" && args[0] === "exec");
  check(codexExecs.length === 1, "the strict exact runner dispatched more than one Codex exec");
}
