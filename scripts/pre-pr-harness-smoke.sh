#!/usr/bin/env bash
set -euo pipefail

mode="--dry-run"
if [[ "${1:-}" == "--live" ]]; then
  mode="--live"
elif [[ -n "${1:-}" && "${1:-}" != "--dry-run" ]]; then
  echo "Usage: yarn prepr:harness [--dry-run|--live]" >&2
  exit 2
fi

if [[ "$mode" == "--live" && "${ASK_LLM_HARNESS_SMOKE_LIVE:-}" != "1" ]]; then
  echo "Live mode requires ASK_LLM_HARNESS_SMOKE_LIVE=1. See docs/HARNESS-SMOKE.md." >&2
  exit 2
fi

printf '%s\n' \
  "=== Canonical harness-facing pre-PR gate ===" \
  "Mode: $mode" \
  "Prerequisites and repository checks are mandatory; live mode is additive and never a CI requirement."

yarn install --immutable
yarn build
yarn lint
yarn test
node scripts/harness-smoke.mjs --dry-run
if [[ "$mode" == "--live" ]]; then
  node scripts/harness-smoke.mjs --live
fi

cat <<'EVIDENCE'

PR evidence (paste without raw harness output):
- `yarn prepr:harness` — PASS
- Harness smoke summary: copy the PASS / SKIP_UNAVAILABLE / SKIP_NOT_AUTHORIZED / FAIL counts
- Live mode (optional): list authorized scenario IDs and exact requested model IDs; do not paste prompts, sessions, credentials, or raw responses
EVIDENCE
