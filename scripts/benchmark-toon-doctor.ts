import { performance } from "node:perf_hooks";
import { decode } from "@toon-format/toon";
import { encodingForModel } from "js-tiktoken";
import { doctorToonDocument, formatDoctorToon } from "../packages/llm-mcp/src/toonDoctor.js";
import type { DiagnosticReport, ProviderProbe } from "../packages/shared/src/doctor.js";

const encoder = encodingForModel("gpt-4o");
const PARSER_RUNS = 100;
const FORMAT_RUNS = 1_000;

function provider(name: string, available: boolean, enrichment?: ProviderProbe["enrichment"]): ProviderProbe {
  const command = name.toLowerCase();
  return {
    name,
    command,
    available,
    cliPath: available ? `/redacted/bin/${command}` : undefined,
    cliVersion: available ? `${command} 1.2.3` : undefined,
    error: available ? undefined : "not found on PATH",
    enrichment,
  };
}

function report(overrides: Partial<DiagnosticReport> = {}): DiagnosticReport {
  return {
    status: "ok",
    generatedAt: "2026-08-20T00:00:00.000Z",
    environment: {
      nodeVersion: "v24.13.0",
      nodeOk: true,
      platform: "darwin",
      arch: "arm64",
      resolvedPath: "/redacted/bin:/usr/bin",
      askLlmPath: undefined,
      timeoutMs: 210_000,
      codexTimeoutMs: 800_000,
      claudeTimeoutMs: 600_000,
      geminiTimeoutMs: 210_000,
    },
    providers: [],
    checks: [
      { name: "Node.js version", status: "pass", message: "v24.13.0 (>= v20 required)" },
      { name: "PATH resolution", status: "pass", message: "Resolved PATH has 2 entries" },
    ],
    ...overrides,
  };
}

const scenarios: Array<[string, DiagnosticReport]> = [
  [
    "single-provider",
    report({
      providers: [
        provider("Gemini", false),
        provider("Codex", true),
        provider("Claude", false),
        provider("Ollama", false),
        provider("Antigravity", false),
      ],
      checks: [
        { name: "Node.js version", status: "pass", message: "v24.13.0 (>= v20 required)" },
        { name: "Provider: Codex", status: "pass", message: "codex 1.2.3 at /redacted/bin/codex" },
      ],
    }),
  ],
  [
    "multi-provider-comparison",
    report({
      providers: [
        provider("Gemini", false),
        provider("Codex", true),
        provider("Claude", true),
        provider("Ollama", false),
        provider("Antigravity", true),
      ],
      checks: [
        { name: "Provider: Codex", status: "pass", message: "available" },
        { name: "Provider: Claude", status: "pass", message: "available" },
        { name: "Provider: Antigravity", status: "pass", message: "available" },
      ],
    }),
  ],
  [
    "review-readiness",
    report({
      status: "warning",
      providers: [
        provider("Codex", true, {
          heading: "codex doctor",
          overall: "warning",
          checks: [
            { name: "auth.credentials", status: "pass", summary: "auth configured" },
            {
              name: "state.rollout_db_parity",
              status: "warn",
              summary: "rollout files and state DB thread inventory differ",
              remediation: "Run codex doctor to inspect.",
            },
          ],
        }),
        provider("Antigravity", true),
        provider("Gemini", false),
        provider("Claude", false),
        provider("Ollama", false),
      ],
      checks: [{ name: "Provider: Codex", status: "pass", message: "available" }],
    }),
  ],
  ["empty", report({ providers: [], checks: [] })],
  [
    "partial",
    report({
      status: "warning",
      providers: [
        provider("Gemini", false),
        provider("Codex", true),
        provider("Claude", false),
        provider("Ollama", false),
        provider("Antigravity", false),
      ],
      checks: [
        { name: "Provider: Codex", status: "pass", message: "available" },
        {
          name: "Provider: Ollama",
          status: "warn",
          message: "endpoint unreachable",
          fix: "Start Ollama, then retry.",
        },
      ],
    }),
  ],
  [
    "unavailable",
    report({
      status: "warning",
      providers: [
        provider("Gemini", false),
        provider("Codex", false),
        provider("Claude", false),
        provider("Ollama", false),
        provider("Antigravity", false),
      ],
      checks: [
        { name: "Provider: Codex", status: "warn", message: "not found", fix: "Install Codex." },
        { name: "Provider: Ollama", status: "warn", message: "not found", fix: "Install Ollama." },
      ],
    }),
  ],
  [
    "failure",
    report({
      status: "error",
      providers: [
        provider("Gemini", false),
        provider("Codex", false),
        provider("Claude", false),
        provider("Ollama", false),
        provider("Antigravity", false),
      ],
      checks: [
        {
          name: "Node.js version",
          status: "fail",
          message: "Node.js is too old",
          fix: "Install Node.js 22 LTS.",
        },
      ],
    }),
  ],
  [
    "truncation",
    report({
      status: "warning",
      providers: [provider("Codex", true)],
      checks: [
        {
          name: "long diagnostic",
          status: "warn",
          message: "diagnostic detail ".repeat(100),
          fix: "remediation detail ".repeat(100),
        },
      ],
    }),
  ],
];

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function formatLatency(run: () => string): number {
  const samples: number[] = [];
  for (let iteration = 0; iteration < FORMAT_RUNS; iteration += 1) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  return median(samples);
}

console.log(
  "| Workflow | JSON bytes | TOON bytes | Saved | JSON tokens | TOON tokens | Saved | JSON ms | TOON ms | Parser reliability |",
);
console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");

for (const [name, value] of scenarios) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  const toon = formatDoctorToon(value);
  const expectedToon = doctorToonDocument(value);
  let parserSuccesses = 0;
  for (let iteration = 0; iteration < PARSER_RUNS; iteration += 1) {
    const jsonOk = JSON.stringify(JSON.parse(json)) === JSON.stringify(value);
    const toonOk = JSON.stringify(decode(toon)) === JSON.stringify(expectedToon);
    if (jsonOk && toonOk) parserSuccesses += 1;
  }
  const jsonBytes = Buffer.byteLength(json);
  const toonBytes = Buffer.byteLength(toon);
  const jsonTokens = encoder.encode(json).length;
  const toonTokens = encoder.encode(toon).length;
  const byteSaved = 1 - toonBytes / jsonBytes;
  const tokenSaved = 1 - toonTokens / jsonTokens;
  const jsonLatency = formatLatency(() => JSON.stringify(value, null, 2));
  const toonLatency = formatLatency(() => formatDoctorToon(value));

  console.log(
    `| ${name} | ${jsonBytes} | ${toonBytes} | ${(byteSaved * 100).toFixed(1)}% | ${jsonTokens} | ${toonTokens} | ${(tokenSaved * 100).toFixed(1)}% | ${jsonLatency.toFixed(3)} | ${toonLatency.toFixed(3)} | ${parserSuccesses}/${PARSER_RUNS} |`,
  );
}
