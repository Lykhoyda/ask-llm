import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { writeJsonKey } from "../hosts/json-merge.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ask-llm-json-merge-")));
const dir = join(root, "config");
const file = join(dir, "mcp.json");
const KEY = ["mcpServers", "ask-llm"];
const ENTRY = { command: "/usr/local/bin/ask-llm-mcp", args: [] };
const allow = () => undefined;

afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
});

function leftovers(): string[] {
  return readdirSync(dir).filter((name) => name !== "mcp.json");
}

describe("writeJsonKey", () => {
  it("creates an absent file and its directory privately", () => {
    rmSync(dir, { recursive: true });
    writeJsonKey(file, KEY, ENTRY, allow);
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify({ mcpServers: { "ask-llm": ENTRY } }, null, 2)}\n`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(leftovers()).toEqual([]);
  });

  it.each([
    ["two spaces with a trailing newline", 2, "\n"],
    ["four spaces without a trailing newline", 4, ""],
    ["tabs", "\t", "\n"],
  ])("keeps unrelated entries and the file's %s", (_, indent, ending) => {
    const before = { theme: "dark", mcpServers: { other: { command: "x", args: ["--y"], env: { A: "1" } } } };
    writeFileSync(file, `${JSON.stringify(before, null, indent)}${ending}`);
    writeJsonKey(file, KEY, ENTRY, allow);
    const expected = { theme: "dark", mcpServers: { ...before.mcpServers, "ask-llm": ENTRY } };
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(expected, null, indent)}${ending}`);

    writeJsonKey(file, KEY, undefined, allow);
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(before, null, indent)}${ending}`);
  });

  it("keeps a single-line file on one line", () => {
    writeFileSync(file, '{"mcpServers":{}}');
    writeJsonKey(file, KEY, ENTRY, allow);
    expect(readFileSync(file, "utf8")).toBe(JSON.stringify({ mcpServers: { "ask-llm": ENTRY } }));
  });

  it.each([
    ["malformed JSON", "{ not json", "is not plain JSON"],
    ["JSON with comments", '{\n  // servers\n  "mcpServers": {}\n}\n', "is not plain JSON"],
    ["a top-level array", "[]", "does not hold a JSON object"],
    ["a non-object parent", '{"mcpServers":[]}', "mcpServers"],
    ["a null parent", '{"mcpServers":null}', "mcpServers"],
    ["an integer beyond double precision", '{"limit":9007199254740993}', "number that would change"],
    ["a number beyond double range", '{"limit":1e400}', "number that would change"],
  ])("refuses %s and leaves the file byte-identical", (_, content, message) => {
    writeFileSync(file, content);
    expect(() => writeJsonKey(file, KEY, ENTRY, allow)).toThrow(message);
    expect(readFileSync(file, "utf8")).toBe(content);
    expect(leftovers()).toEqual([]);
  });

  it.each([
    ["an add", ENTRY],
    ["a removal", undefined],
  ])("checks the value %s would replace and refuses without writing", (_, value) => {
    const content = JSON.stringify({ mcpServers: { "ask-llm": { command: "npx" } } });
    writeFileSync(file, content);
    const seen: unknown[] = [];
    const refuse = (current: unknown) => {
      seen.push(current);
      return "not ours";
    };
    expect(() => writeJsonKey(file, KEY, value, refuse)).toThrow("not ours");
    expect(seen).toEqual([{ command: "npx" }]);
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  it("refuses when the file changes while the update is being written", () => {
    writeFileSync(file, "{}\n");
    const edit = () => {
      writeFileSync(file, '{"mcpServers":{"ask-llm":{"command":"npx"}}}\n');
      return undefined;
    };
    expect(() => writeJsonKey(file, KEY, ENTRY, edit)).toThrow("changed while");
    expect(readFileSync(file, "utf8")).toBe('{"mcpServers":{"ask-llm":{"command":"npx"}}}\n');
    expect(leftovers()).toEqual([]);
  });

  it("keeps the file's permissions", () => {
    writeFileSync(file, "{}\n");
    chmodSync(file, 0o640);
    writeJsonKey(file, KEY, ENTRY, allow);
    expect(statSync(file).mode & 0o777).toBe(0o640);
  });

  it("writes through a symlink to the real file and keeps the link", () => {
    const real = join(root, "real.json");
    writeFileSync(real, '{"theme":"dark"}\n');
    symlinkSync(real, file);
    writeJsonKey(file, KEY, ENTRY, allow);
    expect(realpathSync(file)).toBe(real);
    expect(JSON.parse(readFileSync(real, "utf8"))).toEqual({ theme: "dark", mcpServers: { "ask-llm": ENTRY } });
    rmSync(real);
  });

  it("refuses a dangling symlink instead of replacing it", () => {
    symlinkSync(join(root, "missing.json"), file);
    expect(() => writeJsonKey(file, KEY, ENTRY, allow)).toThrow("dangling");
    expect(existsSync(join(root, "missing.json"))).toBe(false);
  });

  it("refuses while a temp file from an interrupted write exists, leaving both files alone", () => {
    writeFileSync(file, "{}\n");
    writeFileSync(`${file}.ask-llm-tmp`, "partial");
    expect(() => writeJsonKey(file, KEY, ENTRY, allow)).toThrow(`${file}.ask-llm-tmp`);
    expect(readFileSync(file, "utf8")).toBe("{}\n");
    expect(readFileSync(`${file}.ask-llm-tmp`, "utf8")).toBe("partial");
  });

  it("leaves the original intact when the process dies before the rename", () => {
    const original = `${JSON.stringify({ mcpServers: { other: { command: "x" } } }, null, 2)}\n`;
    writeFileSync(file, original);
    const merge = fileURLToPath(new URL("../hosts/json-merge.ts", import.meta.url));
    const script = [
      'import fs from "node:fs";',
      'import { syncBuiltinESMExports } from "node:module";',
      "fs.renameSync = () => process.kill(process.pid, 'SIGKILL');",
      "syncBuiltinESMExports();",
      `const { writeJsonKey } = await import(${JSON.stringify(merge)});`,
      `writeJsonKey(${JSON.stringify(file)}, ${JSON.stringify(KEY)}, ${JSON.stringify(ENTRY)}, () => undefined);`,
    ].join("\n");
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    expect(child.signal).toBe("SIGKILL");
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(JSON.parse(readFileSync(`${file}.ask-llm-tmp`, "utf8")).mcpServers["ask-llm"]).toEqual(ENTRY);
  });
});
