import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  ALLOWED_NPM_PACKAGES,
  ALLOWED_REGISTRY_SERVERS,
  npmPublishViolations,
  publishableWorkspaces,
  registryManifestViolations,
  releaseAllowlistViolations,
} from "./release-allowlist.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SPLIT_PACKAGES = ["antigravity", "claude", "codex", "gemini", "grok", "ollama"];
const RETIRED_NPM = SPLIT_PACKAGES.map((provider) => `@ask-llm/${provider}-mcp`);
const RETIRED_REGISTRY = SPLIT_PACKAGES.map((provider) => `io.github.Lykhoyda/ask-${provider}`);

const scratch: string[] = [];
afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(packages: Record<string, Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), "ask-llm-release-allowlist-"));
  scratch.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, workspaces: ["packages/*", "apps/docs"] }));
  for (const [dir, manifest] of Object.entries({ "apps/docs": { name: "docs", private: true }, ...packages })) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest));
  }
  return root;
}

function serverJson(root: string, name: string, identifier: string): string {
  const path = join(root, "server.json");
  writeFileSync(path, JSON.stringify({ name, version: "1.0.0", packages: [{ registryType: "npm", identifier }] }));
  return path;
}

const canonical = {
  "packages/llm-mcp": { name: "@ask-llm/mcp" },
  "packages/claude-plugin": { name: "@ask-llm/plugin" },
};

describe("release allowlist", () => {
  it("allows exactly @ask-llm/mcp, @ask-llm/plugin and io.github.Lykhoyda/ask-llm", () => {
    expect([...ALLOWED_NPM_PACKAGES].sort()).toEqual(["@ask-llm/mcp", "@ask-llm/plugin"]);
    expect(ALLOWED_REGISTRY_SERVERS).toEqual(["io.github.Lykhoyda/ask-llm"]);
    expect(npmPublishViolations(["@ask-llm/mcp", "@ask-llm/plugin"])).toEqual([]);
    expect(registryManifestViolations({ name: "io.github.Lykhoyda/ask-llm", packages: [] })).toEqual([]);
  });

  it("rejects every retired split package and unknown or missing names", () => {
    for (const name of [...RETIRED_NPM, "ask-gemini-mcp", "@ask-llm/shared", "@ask-llm/mcp-extra", undefined]) {
      expect(npmPublishViolations([name]), String(name)).toHaveLength(1);
    }
  });

  it("rejects every retired Registry server and a canonical server that points at a retired npm package", () => {
    for (const name of [...RETIRED_REGISTRY, "io.github.Lykhoyda/ask-llm-next", undefined]) {
      expect(registryManifestViolations({ name, packages: [] }), String(name)).toHaveLength(1);
    }
    expect(
      registryManifestViolations({
        name: "io.github.Lykhoyda/ask-gemini",
        packages: [{ registryType: "npm", identifier: "@ask-llm/gemini-mcp" }],
      }),
    ).toEqual([
      'server.json: Registry server "io.github.Lykhoyda/ask-gemini" is not in the release allowlist',
      'server.json: npm package "@ask-llm/gemini-mcp" is not in the release allowlist',
    ]);
    expect(
      registryManifestViolations({
        name: "io.github.Lykhoyda/ask-llm",
        packages: [{ registryType: "npm", identifier: "@ask-llm/codex-mcp" }],
      }),
    ).toEqual(['server.json: npm package "@ask-llm/codex-mcp" is not in the release allowlist']);
  });

  it("treats only non-private workspaces as the npm publish set", () => {
    const root = fixture({
      ...canonical,
      "packages/gemini-mcp": { name: "@ask-llm/gemini-mcp", private: true },
      "packages/shared": { name: "@ask-llm/shared", private: true },
    });
    expect(publishableWorkspaces(root)).toEqual([
      { dir: "packages/claude-plugin", name: "@ask-llm/plugin" },
      { dir: "packages/llm-mcp", name: "@ask-llm/mcp" },
    ]);
    expect(releaseAllowlistViolations(root, [serverJson(root, "io.github.Lykhoyda/ask-llm", "@ask-llm/mcp")])).toEqual(
      [],
    );
  });

  it("fails when a retired split package loses private: true", () => {
    const root = fixture({ ...canonical, "packages/gemini-mcp": { name: "@ask-llm/gemini-mcp" } });
    expect(releaseAllowlistViolations(root, [])).toEqual([
      'packages/gemini-mcp: npm package "@ask-llm/gemini-mcp" is not in the release allowlist',
    ]);
  });

  it("holds for this repository: only the canonical packages are publishable and every split workspace is private", () => {
    expect(
      publishableWorkspaces(ROOT)
        .map(({ name }) => name)
        .sort(),
    ).toEqual(["@ask-llm/mcp", "@ask-llm/plugin"]);
    expect(releaseAllowlistViolations(ROOT, ["packages/llm-mcp/server.json"])).toEqual([]);
    for (const provider of SPLIT_PACKAGES) {
      const manifest = JSON.parse(readFileSync(join(ROOT, `packages/${provider}-mcp/package.json`), "utf8"));
      expect(manifest.private, provider).toBe(true);
      expect(manifest.publishConfig, provider).toBeUndefined();
    }
  });
});

describe("release allowlist call sites", () => {
  function run(script: string, ...args: string[]) {
    return spawnSync(process.execPath, [join(ROOT, "scripts", script), ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, MCP_PUBLISHER_PATH: "/nonexistent/mcp-publisher" },
    });
  }

  it("the guard CLI passes on the canonical manifest and fails on a retired one", () => {
    const ok = run("release-allowlist.ts");
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("[release-allowlist] OK");

    const root = fixture({});
    const retired = serverJson(root, "io.github.Lykhoyda/ask-gemini", "@ask-llm/gemini-mcp");
    const refused = run("release-allowlist.ts", retired);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('Registry server "io.github.Lykhoyda/ask-gemini" is not in the release allowlist');
    expect(refused.stderr).toContain('npm package "@ask-llm/gemini-mcp" is not in the release allowlist');
  });

  it("the Registry publisher refuses a retired server before running mcp-publisher", () => {
    const root = fixture({});
    const retired = serverJson(root, "io.github.Lykhoyda/ask-codex", "@ask-llm/codex-mcp");
    const refused = run("publish-mcp-registry.ts", "--dry-run", retired);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("MCP Registry publication refused");
    expect(refused.stderr).toContain('Registry server "io.github.Lykhoyda/ask-codex" is not in the release allowlist');
    expect(refused.stderr).not.toContain("validate");
  });

  it("runs before changeset publish in the local release script and before publication in the workflow", () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
    expect(scripts["changeset:publish"]).toBe("yarn build && node scripts/release-allowlist.ts && changeset publish");
    const workflow = parse(readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8")) as {
      jobs: { release: { steps: Array<{ id?: string; if?: string; run?: string }> } };
    };
    const steps = workflow.jobs.release.steps;
    const guard = steps.findIndex(
      (step) =>
        step.run?.trim().split(/\s+/).join(" ") === "node scripts/release-allowlist.ts packages/llm-mcp/server.json",
    );
    const publish = steps.findIndex((step) => step.id === "changesets");
    expect(guard).toBeGreaterThan(-1);
    expect(steps[guard]?.if).toBeUndefined();
    expect(publish).toBeGreaterThan(guard);
  });
});
