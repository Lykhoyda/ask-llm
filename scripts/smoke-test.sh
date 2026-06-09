#!/bin/sh
set -e
set -o pipefail

# When the smoke test itself burns the very Gemini/Codex quota that the next
# push needs, we get a rate-limit-self-defeating loop: push N fails because
# pushes 1..N-1 consumed the window. Detect quota/rate-limit errors and treat
# them as skip-with-warning rather than a hard failure. Set FORCE_SMOKE=1 to
# disable the escape and require all smokes to pass regardless. See ADR-051.
# Match both raw CLI quota phrasings (gemini RESOURCE_EXHAUSTED; codex 0.137
# "usage limit") AND the executors' OWN quota status text ("quota exceeded",
# logged whenever isQuotaError fires + the fallback). The executor signal is
# the robust anchor — the raw CLI message is caught internally during fallback
# and may not reach the smoke output (ADR-117).
QUOTA_PATTERN='rateLimitExceeded|RESOURCE_EXHAUSTED|TerminalQuotaError|exhausted your capacity|code=429|usage limit|quota exceeded'

# Live API calls occasionally fail with transient errors (network blips, brief
# 5xx, upstream-API hiccups) that succeed on retry. Default behavior: one
# silent retry on any non-quota failure with a 5s sleep between attempts.
# Quota errors get the immediate skip-with-warning above (retry won't help —
# quota exhaustion isn't transient). Set NO_SMOKE_RETRY=1 to disable retries
# and treat the first failure as final (useful for debugging real regressions).
RETRY_DELAY_SEC=${RETRY_DELAY_SEC:-5}

TMPFILE="$(mktemp /tmp/ask-llm-smoke-XXXXXX)"
trap 'rm -f "$TMPFILE"' EXIT HUP INT TERM

run_smoke() {
  label="$1"
  workspace="$2"

  attempt=1
  max_attempts=2
  [ -n "${NO_SMOKE_RETRY:-}" ] && max_attempts=1

  while [ "$attempt" -le "$max_attempts" ]; do
    if [ "$attempt" -eq 1 ]; then
      echo ">> $label integration..."
    else
      echo ">> $label integration (retry attempt $attempt/$max_attempts after transient failure)..."
    fi
    : > "$TMPFILE"

    rc=0
    SMOKE_TEST=1 yarn workspace "$workspace" run test -- --reporter=verbose 2>&1 | tee "$TMPFILE" || rc=$?

    if [ "$rc" -eq 0 ]; then
      if [ "$attempt" -gt 1 ]; then
        echo "✓ $label passed on retry — first attempt was transient."
      fi
      echo ""
      return 0
    fi

    # Quota errors: skip immediately, no retry (quota exhaustion isn't transient).
    if [ -z "${FORCE_SMOKE:-}" ] && grep -qE "$QUOTA_PATTERN" "$TMPFILE"; then
      echo ""
      echo "⚠️  $label smoke test hit a quota/rate limit — treating as skip-with-warning."
      echo "    Set FORCE_SMOKE=1 to require these to pass even on rate-limit errors."
      echo ""
      return 0
    fi

    if [ "$attempt" -lt "$max_attempts" ]; then
      echo ""
      echo "⚠️  $label attempt $attempt/$max_attempts failed (exit $rc, not a rate limit). Retrying in ${RETRY_DELAY_SEC}s..."
      sleep "$RETRY_DELAY_SEC"
    fi
    attempt=$((attempt + 1))
  done

  echo ""
  if [ "$max_attempts" -gt 1 ]; then
    echo "❌ $label smoke test failed twice (exit code $rc)."
  else
    echo "❌ $label smoke test failed (exit code $rc, retries disabled via NO_SMOKE_RETRY)."
  fi
  return "$rc"
}

echo "=== Smoke Tests ==="
echo ""

run_smoke "Ollama" "ask-ollama-mcp"
run_smoke "Gemini" "ask-gemini-mcp"
run_smoke "Codex"  "ask-codex-mcp"

echo "=== Smoke tests done (any quota-skipped providers were warned above) ==="
