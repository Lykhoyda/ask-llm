#!/usr/bin/env bash
# bash (not /bin/sh): `set -o pipefail` is a bash builtin — under a POSIX
# /bin/sh like Debian/Ubuntu dash it errors out ("illegal option -o pipefail")
# and, with `set -e`, aborts before any smoke runs. pipefail is load-bearing
# here: the `yarn … | tee` pipeline below relies on it to surface yarn's exit
# code. Callers (.husky/pre-push, package.json "smoke") invoke via `bash` too.
set -e
set -o pipefail

# When the smoke test itself burns the very provider quota that the next push
# needs, we get a rate-limit-self-defeating loop: push N fails because pushes
# 1..N-1 consumed the window. Detect quota/rate-limit errors and treat them as
# skip-with-warning rather than a hard failure. Set FORCE_SMOKE=1 to disable the
# escape and require all smokes to pass regardless. See ADR-051.
# Match both raw CLI quota phrasings (codex 0.137 "usage limit"; antigravity
# "subscription rate limit" / "too many requests") AND the executors' OWN quota
# status text ("quota exceeded", logged whenever isQuotaError fires + the
# fallback). The executor signal is the robust anchor — the raw CLI message is
# caught internally during fallback and may not reach the smoke output (ADR-117).
QUOTA_PATTERN='rateLimitExceeded|RESOURCE_EXHAUSTED|TerminalQuotaError|exhausted your capacity|code=429|usage limit|hit your limit|quota exceeded|rate limit|too many requests|overloaded'

# Live API calls occasionally fail with transient errors (network blips, brief
# 5xx, upstream-API hiccups) that succeed on retry. Default behavior: one
# silent retry on any non-quota failure with a 5s sleep between attempts.
# Quota errors get the immediate skip-with-warning above (retry won't help —
# quota exhaustion isn't transient). Set NO_SMOKE_RETRY=1 to disable retries
# and treat the first failure as final (useful for debugging real regressions).
RETRY_DELAY_SEC=${RETRY_DELAY_SEC:-5}

REPO_ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
TMPFILE="$(mktemp /tmp/ask-llm-smoke-XXXXXX)"
trap 'rm -f "$TMPFILE"' EXIT HUP INT TERM

run_smoke() {
  label="$1"
  package_path="$2"

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
    (cd "$REPO_ROOT" && SMOKE_TEST=1 yarn test "$package_path" --reporter=verbose) 2>&1 | tee "$TMPFILE" || rc=$?

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

# Optional git-ignored local overrides for contributors whose machine can't run
# a factory-default provider model (e.g. Ollama's qwen3.6:27b is too big for this
# box). Export env such as ASK_OLLAMA_MODEL here to steer just the smoke run — the
# published FACTORY_DEFAULT_MODEL and CI are unaffected. See
# scripts/smoke-test.local.sh.example for a template.
SMOKE_LOCAL="$(CDPATH= cd "$(dirname "$0")" && pwd)/smoke-test.local.sh"
if [ -f "$SMOKE_LOCAL" ]; then
  echo ">> sourcing local smoke overrides: $SMOKE_LOCAL"
  . "$SMOKE_LOCAL"
fi

echo "=== Smoke Tests ==="
echo ""

run_smoke "Ollama"      "packages/ollama-mcp"
run_smoke "Antigravity" "packages/antigravity-mcp"
run_smoke "Codex"       "packages/codex-mcp"
run_smoke "Claude"      "packages/claude-mcp"

echo "=== Smoke tests done (any quota-skipped providers were warned above) ==="
