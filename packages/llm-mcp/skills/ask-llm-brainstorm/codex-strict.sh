#!/usr/bin/env bash
# CLI-only brainstorm consultation. The prompt arrives on stdin.
set -euo pipefail

model=${1:-}
effort=${2:-high}
if [[ $# -gt 2 || ! $model =~ ^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$ || $model =~ ^[Aa][Uu][Tt][Oo]$ ]]; then
  echo "Usage: bash codex-strict.sh <exact Codex model ID> [reasoning effort] < prompt" >&2
  exit 2
fi
case "$effort" in
  low|medium|high|xhigh|max|ultra) ;;
  *) echo "Invalid Codex reasoning effort: $effort" >&2; exit 2 ;;
esac
if ! command -v codex >/dev/null; then
  echo "Codex CLI is unavailable on PATH." >&2
  exit 127
fi
if ! command -v node >/dev/null; then
  echo "Node.js is required to verify the Codex CLI terminal outcome." >&2
  exit 127
fi

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
args=(exec --ephemeral --skip-git-repo-check --sandbox read-only)
if [[ ${ASK_CODEX_LOAD_USER_CONFIG:-} != 1 ]]; then
  args+=(--ignore-user-config --ignore-rules)
fi
args+=(-m "$model" -c "model_reasoning_effort=\"$effort\"" --json -)
rc=0
codex "${args[@]}" > "$workdir/events.jsonl" || rc=$?

# Like the executor's strict mode, a terminal failure invalidates earlier text.
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const [path, model, effort, status] = process.argv.slice(1);
  const attribution = `Codex CLI · selected ${model} · reasoning effort configured ${effort}`;
  let message;
  let completedAnswer;
  let error;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.type === "turn.started") {
      message = undefined;
      completedAnswer = undefined;
    } else if (event?.type === "item.completed" && event.item?.type === "agent_message") {
      if (typeof event.item.text === "string" && event.item.text.length > 0) message = event.item.text;
    } else if (event?.type === "turn.completed") {
      completedAnswer = message;
      error = undefined;
    } else if (event?.type === "turn.failed") {
      error = event.error?.message ?? JSON.stringify(event);
      break;
    } else if (event?.type === "error") {
      error = event.message ?? JSON.stringify(event);
    }
  }
  if (error !== undefined || Number(status) !== 0 || !completedAnswer?.trim()) {
    console.error(`${attribution}: ${error ?? (Number(status) !== 0
      ? `Codex exited with status ${status}.`
      : "Codex ended without a completed turn containing an answer.")}`);
    process.exitCode = Number(status) || 1;
  } else {
    console.log(`${attribution}\n${completedAnswer}`);
  }
' "$workdir/events.jsonl" "$model" "$effort" "$rc"
