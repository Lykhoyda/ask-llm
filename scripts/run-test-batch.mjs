import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

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
  return [...files]
    .sort((a, b) => a.localeCompare(b, "en"))
    .filter((_, position) => position % count === index - 1);
}

export function vitestCommand(files, platform = process.platform) {
  return {
    command: platform === "win32" ? "yarn.cmd" : "yarn",
    args: ["vitest", "run", ...files],
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
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
  const { command } = vitestCommand([]);
  const output = run(command, ["vitest", "list", "--filesOnly", "--json"], { capture: true });
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
  const { command, args } = vitestCommand(files);
  run(command, args);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
