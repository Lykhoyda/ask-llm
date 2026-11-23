import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

interface PackedArchive {
  filename: string;
  files: { path: string }[];
}

it("packs the server, command entrypoints, and complete host resources into the canonical tarball", () => {
  const temp = mkdtempSync(join(tmpdir(), "ask-llm-canonical-pack-"));
  try {
    const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], {
      cwd: join(root, "packages/llm-mcp"),
      encoding: "utf8",
    });
    expect(pack.status, pack.stderr).toBe(0);
    const archives = JSON.parse(pack.stdout) as PackedArchive[] | Record<string, PackedArchive>;
    const archive = Array.isArray(archives) ? archives[0] : archives["@ask-llm/mcp"];
    expect(archive).toBeDefined();
    const files = archive.files.map((file) => file.path);
    for (const path of [
      "dist/index.js",
      "dist/cli.js",
      "dist/codex-mcp.js",
      "dist/ask-llm.js",
      "dist/machine.js",
      "dist/cursor.js",
      ".claude-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
      ".mcp.json",
      "mcp.json",
      "skills/ask-llm-review/SKILL.md",
      "skills/ask-llm-brainstorm/codex-strict.sh",
      "agents/codex-reviewer.md",
      "hooks/hooks.json",
      "pi/extensions/index.ts",
      "prompts/review.txt",
      "scripts/codex-pair-session.mjs",
      "scripts/plugin-mcp-server.mjs",
      "scripts/lib/state.mjs",
      "codex-pair-defaults.json",
    ]) {
      expect(files, path).toContain(path);
    }
    const manifest = spawnSync("tar", ["-xOzf", join(temp, archive.filename), "package/package.json"], {
      encoding: "utf8",
    });
    expect(manifest.status, manifest.stderr).toBe(0);
    const pkg = JSON.parse(manifest.stdout);
    expect(pkg.bin).toMatchObject({ "ask-llm": "dist/ask-llm.js", "ask-llm-mcp": "dist/cli.js", mcp: "dist/cli.js" });
    expect(Object.keys(pkg.dependencies).filter((name) => name.startsWith("@ask-llm/"))).toEqual([]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
