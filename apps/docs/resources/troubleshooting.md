---
description: Common issues and solutions for Ask LLM MCP servers. Connection errors, timeouts, quota limits, provider auth, and platform-specific fixes.
---

# Troubleshooting

> **Run the doctor first.** `npx @ask-llm/mcp doctor` checks Node version, PATH, every provider CLI's presence + version, and env vars. It works even when MCP can't start. 90%+ of setup issues are caught here with a clear failed-check line; fix from the bottom of the report up.

```bash
npx @ask-llm/mcp doctor          # human-readable
npx @ask-llm/mcp doctor --json   # machine-readable, exit 1 on error
```

<script setup>
import TroubleshootingModal from '../.vitepress/components/TroubleshootingModal.vue'
</script>

## Installation Issues

<TroubleshootingModal
  title='"Command not found: gemini" / "codex" / "ollama"'
  preview="Provider CLI is not installed or not on PATH"
>

A provider CLI is missing or not on PATH. Install:

```bash
# Gemini
npm install -g @google/gemini-cli && gemini login

# Codex
npm install -g @openai/codex
# then follow the codex CLI's auth instructions

# Ollama (https://ollama.com)
ollama pull qwen3.6:27b
```

Verify:

```bash
gemini --version    # or: which gemini
codex --version
ollama list
```

If `npx @ask-llm/mcp doctor` reports a CLI as "not found on PATH" but `which <cli>` works in your terminal, the issue is PATH inheritance; see the next entry.

</TroubleshootingModal>

<TroubleshootingModal
  title='"PATH issue": CLI works in terminal but MCP server says "not found"'
  preview="macOS GUI apps don't inherit your shell PATH"
>

macOS GUI applications (Claude Desktop, Cursor, etc.) don't source `.zshrc` / `.bashrc`, so nvm / Homebrew / Volta paths aren't visible to the MCP server. Ask LLM resolves this automatically by extracting the real PATH from your login shell at startup.

If it's still failing:

1. Confirm `npx @ask-llm/mcp doctor` shows a non-empty `Resolved PATH` with the CLI's directory in it.
2. If it doesn't, set `ASK_LLM_PATH` explicitly in your MCP client's env config:

```json
{
  "mcpServers": {
    "ask-llm": {
      "command": "npx",
      "args": ["-y", "@ask-llm/mcp"],
      "env": {
        "ASK_LLM_PATH": "/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/v22.0.0/bin"
      }
    }
  }
}
```

3. Restart your MCP client completely (not just reload).

</TroubleshootingModal>

<TroubleshootingModal
  title="Windows NPX flag issues"
  preview='error: unknown option "-y" when using Claude Code on Windows'
>

**Solutions** (try in order):

```bash
# Method 1: Install globally first (skips npx entirely)
# The global install keeps the original `ask-llm-mcp` executable name.
npm install -g @ask-llm/mcp
claude mcp add --scope user ask-llm -- ask-llm-mcp

# Method 2: --yes instead of -y
claude mcp add --scope user ask-llm -- npx --yes @ask-llm/mcp

# Method 3: Drop the flag entirely
claude mcp add --scope user ask-llm -- npx @ask-llm/mcp
```

</TroubleshootingModal>

<TroubleshootingModal
  title="MCP server not responding (Claude Desktop cannot connect)"
  preview="Server fails to start or connection drops"
>

**Step-by-step:**

1. **Check Node.js version**: must be ≥ v20:
   ```bash
   node --version
   ```
2. **Run the doctor** to identify what's missing:
   ```bash
   npx @ask-llm/mcp doctor
   ```
3. **Verify Claude Desktop config syntax**: use a JSON validator. Common bugs: trailing commas, missing brackets.
4. **Restart Claude Desktop completely**:
   - Quit (Cmd+Q on Mac), wait 5s, reopen.
   - Just reloading the window is not enough.
5. **Check logs** for the actual error:
   - macOS: `~/Library/Logs/Claude/mcp-server-*.log`
   - Windows: `%APPDATA%\Claude\logs\`

</TroubleshootingModal>

<TroubleshootingModal
  title='EUNSUPPORTEDPROTOCOL workspace:* (npx fails to start)'
  preview='Stale npx cache from a pre-1.5.7 install poisons new runs. Clear it.'
>

Symptom: Claude Desktop or any `npx -y @ask-llm/mcp` invocation fails with:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

**Fix in one line:** `rm -rf ~/.npm/_npx && npm cache clean --force` then re-launch.

Why this happens: pre-1.5.7 releases shipped unrewritten `workspace:*` strings in their published `package.json`. The npx cache at `~/.npm/_npx/<hash>/` keeps tarballs forever; npx never invalidates it on its own, even when a newer version is published. When you run `npx -y @ask-llm/mcp` again, npm walks the cache, finds the stale entry, fails dep-graph validation against `workspace:*`, and aborts before it gets to the new tarball. **Today's published packages are clean**; the bug source is purely the cached old install on your machine.

Why the one-liner works:

- `rm -rf ~/.npm/_npx` purges the per-CLI npx cache; the next `npx -y` rebuilds it from a clean download.
- `npm cache clean --force` is belt-and-suspenders; clears the global `~/.npm/_cacache/` in case anything stale lingered there too.

After clearing, `npx -y @ask-llm/mcp` re-downloads the latest version and starts cleanly. You should see lines like `[GMCPT] Provider Codex (codex)` reporting each detected provider as available in the Claude Desktop debug log.

This is a one-shot; once you've cleared the cache and run a clean install, the cache is poison-free and stays that way as long as you only install post-1.5.7 versions (which is everything since 2026-04-01).

</TroubleshootingModal>

## Connection & Auth

<TroubleshootingModal
  title='"Authentication failed" / "401 Unauthorized"'
  preview="Provider CLI isn't authenticated"
>

Each provider has its own auth flow:

- **Gemini**: `gemini login` (OAuth) or set `GEMINI_API_KEY` env var. **Note:** Gemini CLI is [enterprise-gated from 2026-06-18](/providers/gemini); non-enterprise accounts get an auth/quota error here even after a successful login. Switch to `ask-antigravity` or `ask-codex`.
- **Codex**: follow `codex` CLI's auth instructions (varies by version)
- **Ollama**: no auth needed; Ollama just needs to be running locally

Verify each CLI works directly before blaming the MCP server:

```bash
gemini "Hello"
codex exec --skip-git-repo-check "Hello"
curl http://localhost:11434/api/tags    # Ollama
```

</TroubleshootingModal>

<TroubleshootingModal
  title='Quota / rate limit errors (Gemini RESOURCE_EXHAUSTED, Codex 429)'
  preview="Provider quota exhausted"
>

**The executor handles this automatically**: Gemini falls back from `gemini-3.1-pro-preview` to `gemini-3.6-flash`, and Codex falls back from `gpt-5.6-sol` to `gpt-5.6-terra`. You'll see `usage.fellBack: true` in the structured response.

If both Pro and Flash (or both GPT-5.6 Sol and Terra) hit quota, the call fails with both errors surfaced. Wait for the quota window to reset, or:

- Switch to a different provider for the meantime: `Use ask-llm with provider codex ...` instead of Gemini
- Use Ollama locally: `Use ask-llm with provider ollama ...`

</TroubleshootingModal>

<TroubleshootingModal
  title='"Command timed out after Xs"'
  preview="Provider call exceeded the per-provider wall-clock timeout"
>

Defaults differ by provider: **codex 800s** (reasoning models routinely take 5–10 min on substantive prompts), **gemini 210s** (stream-json emits tokens incrementally, usually fast enough). Resolution ladder: per-provider env var > `GMCPT_TIMEOUT_MS` > provider default.

For long analyses (large diffs, deep Codex reasoning):

1. **Override codex's timeout** when only codex is slow:
   ```json
   { "env": { "ASK_CODEX_TIMEOUT_MS": "1200000" } }   // 20 minutes
   ```

2. **Override gemini's timeout** independently:
   ```json
   { "env": { "ASK_GEMINI_TIMEOUT_MS": "600000" } }   // 10 minutes
   ```

3. **Lift both at once** with the global override (kept for backward compatibility):
   ```json
   { "env": { "GMCPT_TIMEOUT_MS": "1200000" } }       // applies to gemini AND codex
   ```

4. **For multi-provider review skills** (`/multi-review`, `/brainstorm`), large diffs may take 5–15 min; use the diff size policy in those skills (filter docs/binaries, truncate above 150KB) to keep them tractable.

5. **For very large prompts**, consider splitting the work or using `ask-gemini` with `includeDirs` instead of one giant prompt.

Note: Claude Desktop has its own client-side timeout (~4 min on some setups) that runs independently of the server. Raising server-side timeouts past that gives the REPL and direct executor calls more headroom but won't help Claude Desktop sessions specifically.

To check the resolved per-provider timeouts on your machine, run `ask-llm:diagnose`; its `Timeouts:` line shows the effective values for both codex and gemini.

</TroubleshootingModal>

## Tool & API Issues

<TroubleshootingModal
  title='"Provider X is not available" / tool call rejects provider'
  preview="The orchestrator didn't detect the provider at startup"
>

The orchestrator (`@ask-llm/mcp`) detects available providers at startup. If a provider you expected isn't there:

1. Run `npx @ask-llm/mcp doctor` to see what it detects.
2. The most common cause is PATH not finding the provider CLI; see the PATH issue entry above.
3. For Ollama specifically, it must be **running** at `http://localhost:11434` (or wherever `OLLAMA_HOST` points). Not just installed.
4. Restart your MCP client to re-detect providers.

</TroubleshootingModal>

<TroubleshootingModal
  title='"Sub-agent silently produces 0-byte output" / brainstorm coordinator hang'
  preview="Provider process killed by sub-agent lifecycle"
>

This is a known bug class: Claude Code sub-agents can't own background processes that outlive their turn, so `(cmd &) && wait` patterns or `run_in_background: true` on dispatch calls cause processes to be SIGKILLed silently.

The brainstorm-coordinator agent uses the correct pattern (single foreground blocking Bash with direct backgrounding + per-PID wait + `timeout: 600000`). If you're seeing this in custom skills you're writing, follow the same pattern; see the agent prompt in `packages/claude-plugin/agents/brainstorm-coordinator.md` for the canonical template.

</TroubleshootingModal>

## Model & Response Issues

<TroubleshootingModal
  title="Response gets cut off mid-stream"
  preview="MCP message size limits or executor timeout"
>

For Gemini, large responses are chunked automatically; Claude can call `fetch-chunk` to retrieve subsequent chunks from the cached response.

For Codex / Ollama, very large responses can hit the MCP message limit. Workarounds:

- Ask for shorter responses ("3 bullets max", "1-paragraph summary")
- Split the work; run the prompt twice with narrower scope
- Use the REPL where output streams directly to stdout without MCP message size limits

</TroubleshootingModal>

## Plugin Issues

<TroubleshootingModal
  title="Plugin slash commands not appearing in Claude Code"
  preview="Plugin not installed or not loaded"
>

Verify the plugin is installed and active:

```text
/plugin list
```

If `ask-llm` isn't there, install it:

```text
/plugin marketplace add Lykhoyda/ask-llm
/plugin install ask-llm@ask-llm-plugins
/reload-plugins
```

The plugin bundles its Codex MCP registration. After installing or upgrading, fully restart Claude Code and inspect it:

```text
/mcp
```

If no Ask LLM Codex server is listed, the registration is missing; provision the supported server explicitly:

```bash
claude mcp add --scope user codex -- npx -y @ask-llm/codex-mcp
```

If `plugin:ask-llm:codex` or `codex` appears in `claude mcp list` but is disconnected, the service is registered but unavailable. `/sol-review` preserves source-plugin and session-local MCP/settings context for this inventory check, treats failed health or an MCP transport failure as unavailable, and distinguishes that state from a missing registration before disclosing the CLI fallback. Diagnose the provider and restart the host:

```bash
npx -y @ask-llm/mcp doctor
```

The other provider servers remain user-scoped:

```bash
claude mcp add --scope user gemini -- npx -y @ask-llm/gemini-mcp
claude mcp add --scope user ollama -- npx -y @ask-llm/ollama-mcp
claude mcp add --scope user antigravity -- npx -y @ask-llm/antigravity-mcp
```

</TroubleshootingModal>

## Debug Mode

Enable verbose logging:

```json
{
  "mcpServers": {
    "ask-llm": {
      "command": "npx",
      "args": ["-y", "@ask-llm/mcp"],
      "env": {
        "GMCPT_LOG_LEVEL": "debug"
      }
    }
  }
}
```

Logs go to stderr. Claude Desktop captures them in:

- macOS: `~/Library/Logs/Claude/mcp-server-*.log`
- Windows: `%APPDATA%\Claude\logs\`
- Linux: `~/.config/claude/logs/`

## Getting Help

1. **Run the doctor first**: `npx @ask-llm/mcp doctor`
2. Check [GitHub Issues](https://github.com/Lykhoyda/ask-llm/issues) for similar reports
3. Open a new issue with: doctor output, your client (Claude Code/Desktop/Cursor/etc.), Node version, OS, and what you ran
4. Ask in [GitHub Discussions](https://github.com/Lykhoyda/ask-llm/discussions) for usage questions
