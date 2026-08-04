import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);

function resolveVitestPath() {
  const packagePath = require.resolve("vitest/package.json");
  return resolve(dirname(packagePath), require(packagePath).bin.vitest);
}

export function parseBatch(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match) throw new Error("batch must use the format <index>/<count>");

  const index = Number(match[1]);
  const count = Number(match[2]);
  if (count < 1 || index < 1 || index > count) {
    throw new Error("batch index must be between 1 and count");
  }
  return { index, count };
}

export function assignTestFiles(files, { index, count }) {
  return [...files].sort((a, b) => a.localeCompare(b, "en")).filter((_, position) => position % count === index - 1);
}

function vitestInvocation(args, runtime = {}) {
  return {
    command: runtime.nodePath ?? process.execPath,
    args: [runtime.vitestPath ?? resolveVitestPath(), ...args],
  };
}

export function vitestCommand(files, runtime) {
  return vitestInvocation(["run", ...files], runtime);
}

export function run({ command, args }, options = {}, spawn = spawnSync) {
  const result = spawn(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function discoverTestFiles() {
  const command = vitestInvocation(["list", "--filesOnly", "--json"]);
  const output = run(command, { capture: true });
  return JSON.parse(output).map(({ file }) => relative(root, file));
}

export function main(argv = process.argv.slice(2)) {
  const batch = parseBatch(argv[0]);
  const allFiles = discoverTestFiles();
  const files = assignTestFiles(allFiles, batch);

  console.log(`Test batch ${batch.index}/${batch.count}: ${files.length}/${allFiles.length} files`);
  for (const file of files) console.log(`  ${file}`);

  // A suite with fewer files than batches legitimately has empty batches.
  if (files.length === 0) return;
  run(vitestCommand(files));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
