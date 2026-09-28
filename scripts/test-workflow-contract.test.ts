import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const parsedWorkflow = parse(readFileSync(resolve(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8")) as {
  jobs: Record<string, WorkflowJob>;
};
const pluginManifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../packages/llm-mcp/package.json"), "utf8"),
);
const batch = "$" + "{{ matrix.batch }}";
const piVersion = "$" + "{{ matrix.pi-version }}";
const nodeVersion = "$" + "{{ matrix.node-version }}";

interface WorkflowJob {
  name?: string;
  needs?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  strategy?: { matrix?: Record<string, unknown> };
  steps?: {
    name?: string;
    run?: string;
    uses?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
  }[];
}

describe("Pi host support workflow contract", () => {
  const piJob = parsedWorkflow.jobs["pi-package-smoke"];
  const lifecycleStep = piJob.steps?.find(
    (step: { name?: string }) => step.name === "Clean Pi install, discovery, update, remove, and temporary evaluation",
  );

  it("keeps the published floor and current compile SDK as exact non-fail-fast smoke cells", () => {
    expect(piJob.strategy).toEqual({
      "fail-fast": false,
      matrix: { "pi-version": ["0.83.0", "0.84.2"] },
    });
    expect(pluginManifest.devDependencies["@earendil-works/pi-ai"]).toBe("^0.84.2");
    expect(pluginManifest.devDependencies["@earendil-works/pi-coding-agent"]).toBe("^0.84.2");
  });

  it("isolates every Pi package smoke cell", () => {
    expect(lifecycleStep?.env?.HOME).toContain(piVersion);
    expect(lifecycleStep?.env?.PI_CODING_AGENT_DIR).toContain(piVersion);
    expect(lifecycleStep?.env?.PI_PROJECT).toContain(piVersion);
    expect(lifecycleStep?.env?.PI_VERSION).toBe(piVersion);
  });
});

describe("five-batch workflow contract", () => {
  const chains = [
    {
      setupId: "test-setup-node24-ubuntu",
      batchesId: "test-batches-node24-ubuntu",
      gateId: "test-node24-ubuntu",
      nodeVersion: "24.x",
      os: "ubuntu-latest",
    },
  ];

  it("runs install, build, lint, and changeset guard only in one setup per Node/OS leg", () => {
    for (const chain of chains) {
      const setup = parsedWorkflow.jobs[chain.setupId];
      const batches = parsedWorkflow.jobs[chain.batchesId];
      const setupCommands = setup.steps?.map((step) => step.run);

      expect(setup["runs-on"]).toBe(chain.os);
      expect(setup.steps?.find((step) => step.uses?.startsWith("actions/setup-node@"))?.with?.["node-version"]).toBe(
        chain.nodeVersion,
      );
      expect(setupCommands).toEqual(
        expect.arrayContaining([
          "yarn install --immutable",
          "yarn build",
          "yarn lint",
          "node scripts/check-shared-changeset.ts",
        ]),
      );
      expect(setup.steps?.find((step) => step.uses?.startsWith("actions/upload-artifact@"))?.with?.name).toBe(
        `test-setup-${chain.nodeVersion}-${chain.os}`,
      );

      for (const command of [
        "yarn install --immutable",
        "yarn build",
        "yarn lint",
        "node scripts/check-shared-changeset.ts",
      ]) {
        expect(batches.steps?.map((step) => step.run)).not.toContain(command);
      }
    }
  });

  it("fans out exactly five test-only batches from the matching setup artifact", () => {
    for (const chain of chains) {
      const batches = parsedWorkflow.jobs[chain.batchesId];

      expect(batches.needs).toBe(chain.setupId);
      expect(batches.strategy?.matrix?.batch).toEqual([1, 2, 3, 4, 5]);
      expect(batches.steps?.find((step) => step.uses?.startsWith("actions/download-artifact@"))?.with?.name).toBe(
        `test-setup-${chain.nodeVersion}-${chain.os}`,
      );
      expect(batches.steps?.find((step) => step.name === `Run test batch ${batch}/5`)?.run).toBe(
        `yarn test:batch "${batch}/5"`,
      );
      expect(batches.steps?.find((step) => step.uses?.startsWith("actions/upload-artifact@"))?.with?.name).toBe(
        `test-result-${chain.nodeVersion}-${chain.os}-${batch}`,
      );
    }
  });

  it("keeps each legacy check dependent on only its matching five-batch matrix", () => {
    for (const chain of chains) {
      const gate = parsedWorkflow.jobs[chain.gateId];

      expect(gate.name).toBe(`test (${chain.nodeVersion}, ${chain.os})`);
      expect(gate["timeout-minutes"]).toBe(15);
      expect(gate.needs).toBe(chain.batchesId);
      expect(gate.steps?.find((step) => step.uses?.startsWith("actions/download-artifact@"))?.with?.pattern).toBe(
        `test-result-${chain.nodeVersion}-${chain.os}-*`,
      );
      expect(gate.steps?.find((step) => step.name === "Require all five matching batches")?.run?.trim()).toBe(
        'for batch in 1 2 3 4 5; do\n  test -f "test-results/batch-$batch"\ndone',
      );
    }
  });
});

describe("supported CI platforms", () => {
  it("builds and tests only on the current Node LTS and smokes the packed CLIs on it plus the next line", () => {
    expect(Object.keys(parsedWorkflow.jobs).filter((id) => /^test(-setup|-batches)?-node/.test(id))).toEqual([
      "test-setup-node24-ubuntu",
      "test-batches-node24-ubuntu",
      "test-node24-ubuntu",
    ]);
    expect(parsedWorkflow.jobs["global-install-smoke"].strategy?.matrix?.["node-version"]).toEqual(["24.x", "26.x"]);
    const workflowsDir = resolve(import.meta.dirname, "../.github/workflows");
    for (const name of readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file))) {
      const workflow = parse(readFileSync(resolve(workflowsDir, name), "utf8"));
      for (const job of Object.values((workflow.jobs ?? {}) as Record<string, WorkflowJob>)) {
        const matrixVersions = job.strategy?.matrix?.["node-version"];
        if (matrixVersions) expect(matrixVersions, name).toEqual(["24.x", "26.x"]);
        for (const step of job.steps ?? []) {
          if (!step.uses?.startsWith("actions/setup-node@")) continue;
          const version = step.with?.["node-version"];
          if (matrixVersions) {
            expect(version, name).toBe(nodeVersion);
          } else {
            expect([24, "24", "24.x"], name).toContain(version);
          }
        }
      }
    }
  });

  it("does not run Windows jobs in any workflow", () => {
    const workflowsDir = resolve(import.meta.dirname, "../.github/workflows");
    for (const name of readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file))) {
      const workflow = parse(readFileSync(resolve(workflowsDir, name), "utf8"));
      for (const job of Object.values((workflow.jobs ?? {}) as Record<string, WorkflowJob>)) {
        expect(job["runs-on"], name).not.toBe("windows-latest");
      }
    }
  });
});

describe("canonical release selection", () => {
  const release = parse(readFileSync(resolve(import.meta.dirname, "../.github/workflows/release.yml"), "utf8"));
  const steps = release.jobs.release.steps;

  it("routes Registry publication to the canonical manifest and keeps manual dispatch out of npm", () => {
    const registry = steps.find((step: { name?: string }) => step.name === "Publish missing servers to MCP Registry");
    const argv = registry.run.trim().split(/\s+/);
    expect(argv).toEqual(["node", "scripts/publish-mcp-registry.ts", "packages/llm-mcp/server.json"]);
    const publish = steps.find((step: { id?: string }) => step.id === "changesets");
    expect(publish.if).toBe("github.event_name != 'workflow_dispatch'");
    expect(publish.with["create-github-releases"]).toBe(false);
    expect(publish.with["push-git-tags"]).toBe(false);
    expect(publish.env.YARN_NPM_AUTH_TOKEN).toBe("$" + "{{ secrets.NODE_AUTH_TOKEN }}");
  });
});
