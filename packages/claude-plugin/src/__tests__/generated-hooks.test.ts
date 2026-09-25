import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, it } from "vitest";
import { PLUGIN_ROOT, REPO_ROOT } from "./_helpers.js";

// Marketplace git-subdir installs run the committed .mjs with no build step, so it must equal tsc's output.
it("commits exactly the JavaScript that tsc generates from the TypeScript hook and broker sources", () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-generated-"));
  try {
    const tsc = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        path.join(PLUGIN_ROOT, "scripts", "tsconfig.json"),
        "--outDir",
        outDir,
        "--listEmittedFiles",
      ],
      { encoding: "utf8" },
    );
    expect(tsc.status, tsc.stdout + tsc.stderr).toBe(0);
    const emitted = tsc.stdout
      .split("\n")
      .filter((line) => line.startsWith("TSFILE: "))
      .map((line) => path.relative(outDir, line.slice("TSFILE: ".length).trim()));
    expect(emitted.sort()).toEqual([
      "codex-pair-debounce-worker.mjs",
      "codex-pair-prompt-drain.mjs",
      "codex-pair-session.mjs",
      "codex-pair-stop-gate.mjs",
      "codex-pair-watch.mjs",
      "lib/broker-lifecycle.mjs",
      "lib/broker-rpc.mjs",
      "lib/broker-transport.mjs",
      "lib/broker.mjs",
      "lib/frontmatter.mjs",
    ]);
    for (const rel of emitted) {
      const committed = fs.readFileSync(path.join(PLUGIN_ROOT, "scripts", rel), "utf8");
      expect(committed, `${rel} is stale: run yarn workspace @ask-llm/plugin build:hooks`).toBe(
        fs.readFileSync(path.join(outDir, rel), "utf8"),
      );
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
