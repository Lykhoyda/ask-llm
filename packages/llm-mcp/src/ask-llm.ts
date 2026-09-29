#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { Logger } from "@ask-llm/shared";
import { runDoctorCli } from "./doctorCli.js";
import { readPackageJson } from "./packageMetadata.js";
import { runSetupCli } from "./setupCli.js";

const serverCli = fileURLToPath(new URL("./cli.js", import.meta.url));

function help(): string {
  return [
    "Usage: ask-llm <command> [options]",
    "",
    "Commands:",
    "  setup           Preview host registration (ask-llm setup --dry-run [--json])",
    "  doctor          Report provider, host, and environment diagnostics",
    "",
    "Options:",
    "  -h, --help      Show this help",
    "  -V, --version   Show the package version",
    "",
    "Run ask-llm doctor --help for doctor options.",
    "",
  ].join("\n");
}

const args = process.argv.slice(2);
const command = args[0];
if (args.length === 0 || (args.length === 1 && (command === "--help" || command === "-h"))) {
  process.stdout.write(help());
} else if (args.length === 1 && (command === "--version" || command === "-V")) {
  process.stdout.write(`${readPackageJson().version}\n`);
} else if (command === "setup") {
  runSetupCli(args.slice(1), serverCli).then(
    (code) => process.exit(code),
    (error) => {
      Logger.error("setup failed:", error);
      process.exit(1);
    },
  );
} else if (command === "doctor") {
  runDoctorCli(args.slice(1), serverCli).then(
    (code) => process.exit(code),
    (error) => {
      Logger.error("doctor failed:", error);
      process.exit(1);
    },
  );
} else {
  process.stderr.write(`Error: unsupported command or argument.\n\n${help()}`);
  process.exitCode = 2;
}
