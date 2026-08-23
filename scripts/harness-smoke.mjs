#!/usr/bin/env node
import { RESULTS, runHarnessSuite } from "./harness-smoke-lib.mjs";

function usage() {
  console.log(
    `Usage: node scripts/harness-smoke.mjs [--dry-run | --live]\n\n--dry-run  Real adapters over deterministic fake transports; no credentials, sessions, or model calls (default).\n--live     Opt-in calls to individually authorized, installed local harnesses.\n\nLive requires ASK_LLM_HARNESS_SMOKE_LIVE=1 and a comma-separated\nASK_LLM_HARNESS_SMOKE_AUTHORIZED list of exact scenario IDs (or "all").\nExact model IDs must also be supplied with ASK_LLM_HARNESS_SMOKE_<KEY>_MODEL.\nSee docs/HARNESS-SMOKE.md. The suite never logs prompts, credentials, or raw outputs.`,
  );
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}
const unknown = args.filter((arg) => arg !== "--dry-run" && arg !== "--live");
if (unknown.length > 0 || (args.includes("--dry-run") && args.includes("--live"))) {
  usage();
  process.exit(2);
}
const mode = args.includes("--live") ? "live" : "dry-run";
if (mode === "live" && process.env.ASK_LLM_HARNESS_SMOKE_LIVE !== "1") {
  console.error(
    "Refusing live calls: set ASK_LLM_HARNESS_SMOKE_LIVE=1 to acknowledge local credential/quota/metered-spend use.",
  );
  process.exit(2);
}

console.log(`=== Ask LLM local harness smoke (${mode}) ===`);
console.log(
  mode === "live"
    ? "Live calls are local-only and explicitly authorized per surface."
    : "Real adapters over fake transports; no live calls or credentials.",
);
const report = await runHarnessSuite({ mode });
for (const result of report.results) console.log(`${result.status.padEnd(21)} ${result.id} — ${result.reason}`);
const counts = Object.fromEntries(
  Object.values(RESULTS).map((status) => [status, report.results.filter((item) => item.status === status).length]),
);
console.log(
  `Summary: ${Object.entries(counts)
    .map(([status, count]) => `${status}=${count}`)
    .join(" ")}`,
);
console.log("Ephemeral prompts and outputs cleaned up.");
if (counts.FAIL > 0) process.exitCode = 1;
