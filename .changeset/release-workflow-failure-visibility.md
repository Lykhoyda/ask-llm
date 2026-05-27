---
"@ask-llm/plugin": patch
---

# Release workflow hardening — failure-tracking issue + Release status badge

Two complementary fixes that make release-workflow failures visible
after the fact, born from the lived-experience finding that PR #112's
release run sat with a red X for 5 days without anyone noticing.

## What changes

### `release.yml` — open a tracking issue on failure

Adds a final step gated on `if: failure() && steps.changesets.outcome ==
'failure'` that uses `actions/github-script@v7` to:

- Check for an existing open issue with the `release-broken` label
- If one exists: post a comment with the new run URL + commit SHA
  (avoids issue-spam on consecutive failures)
- If none exists: open a new issue titled "Release workflow failed on
  <sha7> — publish blocked" with labels `release-broken` + `urgent`,
  body containing the run URL, commit SHA, likely-cause checklist
  (NODE_AUTH_TOKEN expired/wrong-type, package permission change, npm
  outage), and the fix path

Safety note: uses the octokit API exclusively, no shell evaluation of
untrusted input. All `context.*` values are GitHub-runtime trusted
(sha, runId, serverUrl, repo).

### `README.md` — Release status badge

Adds a Release badge next to the existing CI badge so the workflow
failure state is visible to anyone visiting the repo:

```markdown
[![Release](https://img.shields.io/github/actions/workflow/status/Lykhoyda/ask-llm/release.yml?branch=main&label=release&logo=npm)](https://github.com/Lykhoyda/ask-llm/actions/workflows/release.yml)
```

## What this does NOT change

The publish step itself is unchanged. These fixes don't prevent
failures — they make failures surface loudly so they get fixed
promptly. Publish behavior, version-bump logic, MCP Registry sync,
unified GitHub Release creation — all byte-identical.
