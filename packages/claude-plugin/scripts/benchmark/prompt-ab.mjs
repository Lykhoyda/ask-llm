#!/usr/bin/env node
// ADR-100 prompt A/B benchmark driver.
//
// Runs each fixture through both prompt templates (pre-baseline and the
// post-baseline ADR-099 version), invokes codex with each rendered
// prompt, scores findings against the fixture's probes, and emits a
// markdown report.
//
// Usage:
//   node scripts/benchmark/prompt-ab.mjs [--fixtures all|<name>] \
//        [--model gpt-5.5] [--out report.md] [--timeout-ms 120000]
//
// Cost: each fixture+arm is one codex review (~$0.04–0.07). Four
// fixtures × two arms × ~$0.05 ≈ $0.40 per full run. Set ASK_CODEX_*
// env vars to control quota / fallback model.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPrompt } from "./lib/render-prompt.mjs";
import { invokeCodex } from "./lib/invoke-codex.mjs";
import { score } from "./lib/score.mjs";
import { renderReport } from "./lib/report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "fixtures");
const TEMPLATES_DIR = join(HERE, "templates");

function parseArgs(argv) {
  const args = { fixtures: "all", model: "gpt-5.5", out: "benchmark-report.md", timeoutMs: 120_000 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--fixtures") {
      args.fixtures = v;
      i++;
    } else if (k === "--model") {
      args.model = v;
      i++;
    } else if (k === "--out") {
      args.out = v;
      i++;
    } else if (k === "--timeout-ms") {
      args.timeoutMs = Number(v);
      i++;
    } else if (k === "--help" || k === "-h") {
      console.log(
        `Usage: node prompt-ab.mjs [--fixtures all|<name>] [--model gpt-5.5] [--out FILE] [--timeout-ms N]`,
      );
      process.exit(0);
    }
  }
  return args;
}

function loadFixtures(filter) {
  const all = readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const wanted = filter === "all" ? all : all.filter((n) => n === filter || n.includes(filter));
  return wanted.map((name) => {
    const dir = join(FIXTURES_DIR, name);
    const codePath = join(dir, "code.ts");
    const contextPath = join(dir, "context.md");
    const probesPath = join(dir, "probes.json");
    if (!existsSync(codePath) || !existsSync(contextPath) || !existsSync(probesPath)) {
      return null;
    }
    return {
      name,
      filePath: codePath,
      fileContent: readFileSync(codePath, "utf-8"),
      projectContext: readFileSync(contextPath, "utf-8"),
      probes: JSON.parse(readFileSync(probesPath, "utf-8")),
    };
  }).filter((x) => x !== null);
}

async function runArm({ armName, templatePath, fixtures, model, timeoutMs }) {
  const results = {};
  for (const fixture of fixtures) {
    process.stderr.write(`[${armName}] ${fixture.name}... `);
    const startedAt = Date.now();
    const prompt = renderPrompt({
      templatePath,
      filePath: fixture.filePath,
      fileContent: fixture.fileContent,
      toolName: "Edit",
      projectContext: fixture.projectContext,
      partialView: false,
    });
    try {
      const result = await invokeCodex({ prompt, model, timeoutMs });
      const fixtureScore = score({ verdict: result.parsed, probes: fixture.probes });
      results[fixture.name] = {
        score: fixtureScore,
        usage: result.usage,
        durationMs: Date.now() - startedAt,
      };
      process.stderr.write(
        `done — recall ${(fixtureScore.recall * 100).toFixed(0)}% (${fixtureScore.caught.length}/${fixture.probes.should_flag.length}), ${fixtureScore.extra.length} extra, ${(Date.now() - startedAt) / 1000}s\n`,
      );
    } catch (err) {
      process.stderr.write(`FAILED: ${err.message}\n`);
      results[fixture.name] = { error: err.message, durationMs: Date.now() - startedAt };
    }
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  const fixtures = loadFixtures(args.fixtures);
  if (fixtures.length === 0) {
    console.error(`No fixtures matched "${args.fixtures}"`);
    process.exit(2);
  }
  process.stderr.write(`Running ${fixtures.length} fixtures × 2 arms with model ${args.model}\n\n`);

  const armA = "pre-baseline";
  const armB = "baseline";
  const runs = {
    [armA]: await runArm({
      armName: armA,
      templatePath: join(TEMPLATES_DIR, "pre-baseline.txt"),
      fixtures,
      model: args.model,
      timeoutMs: args.timeoutMs,
    }),
    [armB]: await runArm({
      armName: armB,
      templatePath: join(TEMPLATES_DIR, "baseline.txt"),
      fixtures,
      model: args.model,
      timeoutMs: args.timeoutMs,
    }),
  };

  const report = renderReport({
    fixtures,
    runs,
    meta: {
      timestamp: new Date().toISOString(),
      model: args.model,
      arms: [armA, armB],
    },
  });
  writeFileSync(args.out, report, "utf-8");
  process.stderr.write(`\nReport written to ${args.out}\n`);
}

main().catch((err) => {
  console.error(`benchmark driver failed: ${err.message}`);
  process.exit(1);
});
