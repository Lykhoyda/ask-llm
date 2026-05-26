// Spawns `codex exec --json` with the rendered prompt and parses the
// final agent message into the verdict shape ADR-083 specifies. Tries
// to follow the same JSONL parsing path the real hook uses so the
// benchmark exercises the actual codex CLI surface, not a mock.

import { spawn } from "node:child_process";

export function invokeCodex({ prompt, model = "gpt-5.5", timeoutMs = 300_000, codexBin = "codex" }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      codexBin,
      ["exec", "--json", "--sandbox=read-only", `--model=${model}`, "--ignore-user-config", "--ignore-rules"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    // First-run discovery: codex ignores SIGTERM mid-turn (observed 712s + 985s
    // hangs past a 240s SIGTERM in the ADR-100 first run). SIGKILL + explicit
    // stdio destroy is required to actually release the script. The `settled`
    // guard prevents double-settle if `close` fires after the timer.
    const settleReject = (err) => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      try {
        child.stdout.destroy();
      } catch {}
      try {
        child.stderr.destroy();
      } catch {}
      try {
        child.stdin.destroy();
      } catch {}
      reject(err);
    };

    const settleResolve = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const timer = setTimeout(() => {
      settleReject(new Error(`codex timed out after ${timeoutMs}ms (stdout=${stdout.length}B, stderr=${stderr.length}B captured before SIGKILL)`));
    }, timeoutMs);

    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        settleReject(new Error(`codex exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        settleResolve(parseCodexJsonl(stdout));
      } catch (err) {
        settleReject(err);
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      settleReject(err);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function parseCodexJsonl(stdout) {
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  let agentMessage = null;
  let usage = null;
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type === "item.completed" && event.item?.type === "agent_message") {
      agentMessage = event.item.text;
    } else if (event?.type === "turn.completed") {
      usage = event.usage ?? null;
    }
  }
  if (!agentMessage) throw new Error("no agent_message in codex output");
  return { agentMessage, usage, parsed: tryParseVerdict(agentMessage) };
}

function tryParseVerdict(text) {
  const trimmed = text.trim();
  // Strip code fences if present
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
