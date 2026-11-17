import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cachedPackageDir,
  defaultCacheRoot,
  type LaunchRequest,
  PACKAGE_NAME,
  parseLaunchArgs,
  resolveServerEntry,
  SERVER_ENTRIES,
} from "../../scripts/plugin-mcp-server.mjs";
import { PLUGIN_ROOT } from "./_helpers.js";

const LAUNCHER = path.join(PLUGIN_ROOT, "scripts", "plugin-mcp-server.mjs");
const VERSION = "9.8.7";
let temp: string;

afterEach(() => temp && fs.rmSync(temp, { recursive: true, force: true }));

function tempDir(): string {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-llm-plugin-server-"));
  return temp;
}

// A stand-in @ask-llm/mcp release whose server entry reports how it was started, then exits.
function writeRelease(dir: string, version: string, entries: string[]): void {
  fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version }));
  for (const entry of entries) {
    fs.writeFileSync(
      path.join(dir, entry),
      "process.stdout.write(JSON.stringify({ pid: process.pid, argv: process.argv }) + '\\n');\n",
    );
  }
}

function request(server: string): LaunchRequest {
  return parseLaunchArgs([server, VERSION]);
}

function launch(server: string, env: Record<string, string>, pluginRoot?: string) {
  let script = LAUNCHER;
  if (pluginRoot) {
    script = path.join(pluginRoot, "scripts", "plugin-mcp-server.mjs");
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync(LAUNCHER, script);
  }
  return spawnSync(process.execPath, [script, server, VERSION], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("plugin MCP server launch arguments", () => {
  it("accepts each bundled server with an exact release version", () => {
    expect(parseLaunchArgs(["codex", "1.5.0"])).toEqual({
      server: "codex",
      version: "1.5.0",
      entry: "dist/codex-mcp.js",
    });
    expect(parseLaunchArgs(["ask-llm", "2.0.0-rc.1"])).toEqual({
      server: "ask-llm",
      version: "2.0.0-rc.1",
      entry: "dist/cli.js",
    });
  });

  it.each([["latest"], ["^1.5.0"], ["1.5"], ["1.5.x"], ["file:../mcp"], ["1.5.0 --global"]])(
    "rejects %s, which is not an exact release, so npm can never resolve another version",
    (version) => {
      expect(() => parseLaunchArgs(["codex", version])).toThrow(/not an exact @ask-llm\/mcp version/);
    },
  );

  it("rejects unknown servers, inherited keys and a wrong argument count", () => {
    expect(() => parseLaunchArgs(["gemini", "1.5.0"])).toThrow(/unknown server/);
    expect(() => parseLaunchArgs(["__proto__", "1.5.0"])).toThrow(/unknown server/);
    expect(() => parseLaunchArgs(["codex"])).toThrow(/usage/);
    expect(() => parseLaunchArgs(["codex", "1.5.0", "extra"])).toThrow(/usage/);
  });

  it("maps every server to an entry the package build emits", () => {
    const tsdown = fs.readFileSync(path.join(PLUGIN_ROOT, "tsdown.config.ts"), "utf8");
    for (const entry of Object.values(SERVER_ENTRIES)) {
      const name = path.basename(entry, ".js");
      expect(tsdown).toMatch(new RegExp(`(?:^|\\s)"?${name}"?: "src/`, "m"));
    }
  });

  it("keeps the cache under ASK_LLM_SERVER_CACHE, else XDG_CACHE_HOME, else ~/.cache", () => {
    expect(defaultCacheRoot({ ASK_LLM_SERVER_CACHE: "/c", XDG_CACHE_HOME: "/x" }, "/h")).toBe("/c");
    expect(defaultCacheRoot({ XDG_CACHE_HOME: "/x" }, "/h")).toBe(path.join("/x", "ask-llm", "servers"));
    expect(defaultCacheRoot({}, "/h")).toBe(path.join("/h", ".cache", "ask-llm", "servers"));
  });
});

describe("plugin MCP server resolution", () => {
  it("runs the plugin's own build when it is the pinned release, without touching the cache", () => {
    const root = tempDir();
    const plugin = path.join(root, "plugin");
    writeRelease(plugin, VERSION, ["dist/codex-mcp.js"]);
    const install = vi.fn();
    expect(
      resolveServerEntry(request("codex"), { pluginRoot: plugin, cacheRoot: path.join(root, "cache"), install }),
    ).toEqual({
      entry: path.join(plugin, "dist/codex-mcp.js"),
      source: "plugin",
    });
    expect(install).not.toHaveBeenCalled();
  });

  it("uses the cached release when the plugin is a source checkout or another version", () => {
    const root = tempDir();
    const plugin = path.join(root, "plugin");
    writeRelease(plugin, "1.0.0", ["dist/codex-mcp.js"]);
    const cacheRoot = path.join(root, "cache");
    writeRelease(cachedPackageDir(cacheRoot, VERSION), VERSION, ["dist/codex-mcp.js"]);
    const install = vi.fn();
    expect(resolveServerEntry(request("codex"), { pluginRoot: plugin, cacheRoot, install })).toEqual({
      entry: path.join(cachedPackageDir(cacheRoot, VERSION), "dist/codex-mcp.js"),
      source: "cache",
    });
    expect(install).not.toHaveBeenCalled();
  });

  it("installs the pinned release once when no copy exists", () => {
    const root = tempDir();
    const entry = path.join(root, "installed", "dist/cli.js");
    const install = vi.fn().mockReturnValue({ kind: "ready", entry });
    const resolved = resolveServerEntry(request("ask-llm"), {
      pluginRoot: path.join(root, "plugin"),
      cacheRoot: path.join(root, "cache"),
      install,
    });
    expect(resolved).toEqual({ entry, source: "install" });
    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ version: VERSION }), path.join(root, "cache"));
  });

  it("fails closed without reinstalling when the cached release does not ship the server", () => {
    const root = tempDir();
    const cacheRoot = path.join(root, "cache");
    writeRelease(cachedPackageDir(cacheRoot, VERSION), VERSION, ["dist/cli.js"]);
    const install = vi.fn();
    const resolved = resolveServerEntry(request("codex"), {
      pluginRoot: path.join(root, "plugin"),
      cacheRoot,
      install,
    });
    expect(resolved).toEqual({
      error: expect.stringContaining(`${PACKAGE_NAME}@${VERSION} does not ship the codex server`),
    });
    expect(install).not.toHaveBeenCalled();
  });

  it("fails closed with the manual install command when the install fails", () => {
    const root = tempDir();
    const cacheRoot = path.join(root, "cache");
    const resolved = resolveServerEntry(request("codex"), {
      pluginRoot: path.join(root, "plugin"),
      cacheRoot,
      install: () => null,
    });
    expect(resolved).toEqual({
      error: expect.stringContaining(
        `npm install --prefix ${path.join(cacheRoot, `mcp@${VERSION}`)} ${PACKAGE_NAME}@${VERSION}`,
      ),
    });
  });
});

describe.skipIf(process.platform === "win32")("plugin MCP server process", () => {
  it("runs the server inside the launcher process, seeing only its own entry as argv", () => {
    const root = tempDir();
    const cacheRoot = path.join(root, "cache");
    writeRelease(cachedPackageDir(cacheRoot, VERSION), VERSION, ["dist/codex-mcp.js"]);
    const result = launch("codex", { ASK_LLM_SERVER_CACHE: cacheRoot }, path.join(root, "plugin"));
    expect(result.status, result.stderr).toBe(0);
    const started = JSON.parse(result.stdout) as { pid: number; argv: string[] };
    const entry = path.join(cachedPackageDir(cacheRoot, VERSION), "dist/codex-mcp.js");
    // One process: the launcher's own pid hosts the server; no npm exec or shell parent exists.
    expect(started.pid).toBe(result.pid);
    expect(started.argv).toEqual([process.execPath, entry]);
  });

  it("installs into the cache once, sending npm output to stderr so stdout stays the MCP channel", () => {
    const root = tempDir();
    const cacheRoot = path.join(root, "cache");
    const calls = path.join(root, "npm-calls");
    const npm = path.join(root, "fake-npm");
    // Fake npm: records its arguments, prints noise on stdout, and lays out the requested release.
    fs.writeFileSync(
      npm,
      [
        "#!/bin/sh",
        `echo "$@" >> "${calls}"`,
        'echo "added 1 package"',
        'prefix="$3"',
        'pkg="$prefix/node_modules/@ask-llm/mcp"',
        'mkdir -p "$pkg/dist"',
        `printf '{"name":"@ask-llm/mcp","version":"${VERSION}"}' > "$pkg/package.json"`,
        `printf '%s\\n' "process.stdout.write('server-ready\\\\n')" > "$pkg/dist/cli.js"`,
      ].join("\n"),
      { mode: 0o755 },
    );
    const env = { ASK_LLM_SERVER_CACHE: cacheRoot, ASK_LLM_SERVER_NPM: npm };
    const plugin = path.join(root, "plugin");

    const first = launch("ask-llm", env, plugin);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toBe("server-ready\n");
    expect(first.stderr).toContain("added 1 package");
    const second = launch("ask-llm", env, plugin);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toBe("server-ready\n");

    const recorded = fs.readFileSync(calls, "utf8").trim().split("\n");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatch(/^install --prefix \S+ --no-save .*--ignore-scripts .*@ask-llm\/mcp@9\.8\.7$/);
    expect(fs.readdirSync(cacheRoot)).toEqual([`mcp@${VERSION}`]);
  });

  it("exits non-zero with nothing on stdout when the pinned release cannot be installed", () => {
    const root = tempDir();
    const cacheRoot = path.join(root, "cache");
    const npm = path.join(root, "failing-npm");
    fs.writeFileSync(npm, "#!/bin/sh\necho 'npm error 404' >&2\nexit 1\n", { mode: 0o755 });
    const result = launch(
      "codex",
      { ASK_LLM_SERVER_CACHE: cacheRoot, ASK_LLM_SERVER_NPM: npm },
      path.join(root, "plugin"),
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`cannot start the codex server: ${PACKAGE_NAME}@${VERSION} could not be installed`);
    // The private staging directory is removed, so a later launch retries cleanly.
    expect(fs.readdirSync(cacheRoot)).toEqual([]);
  });

  it("rejects a malformed definition before resolving anything", () => {
    const result = spawnSync(process.execPath, [LAUNCHER, "codex", "latest"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('"latest" is not an exact @ask-llm/mcp version');
  });
});
