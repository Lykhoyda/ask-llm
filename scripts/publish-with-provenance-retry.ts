import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";

const REKOR_CONFLICT =
  /error creating tlog entry - \(409\) an equivalent entry already exists in the transparency log with UUID [a-f0-9]+/i;
const RETRY_DELAYS_MS = [2_000, 4_000];

type PublishResult = { code: number | null; stdout: string; stderr: string };

function runChangesets(args: string[]): Promise<PublishResult> {
  return new Promise((resolve, reject) => {
    // Inherit CHANGESETS_OUTPUT so each invocation appends its local tag events for the action.
    const child = spawn("changeset", ["publish", ...args], { stdio: ["inherit", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export async function publishWithProvenanceRetry(
  args: string[],
  runPublish = runChangesets,
  wait: (ms: number) => Promise<void> = setTimeout,
): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const { code, stdout, stderr } = await runPublish(args);
    const delay = RETRY_DELAYS_MS[attempt];
    // The default publish command recomputes its plan from npm on every invocation.
    // Custom arguments can select a saved plan, so run custom commands only once.
    if (
      code !== 1 ||
      args.length > 0 ||
      delay === undefined ||
      !REKOR_CONFLICT.test(stripVTControlCharacters(`${stdout}\n${stderr}`))
    ) {
      return code ?? 1;
    }
    console.warn(`Rekor reported a duplicate provenance entry. Rechecking npm and retrying in ${delay / 1_000}s.`);
    await wait(delay);
  }
}

if (import.meta.main) {
  process.exitCode = await publishWithProvenanceRetry(process.argv.slice(2));
}
