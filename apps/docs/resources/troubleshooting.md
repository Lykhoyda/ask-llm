---
description: Common issues and solutions for Ask LLM MCP servers. Connection errors, timeouts, quota limits, provider auth, and platform-specific fixes.
---

# Troubleshooting

> **Run the doctor first.** `ask-llm doctor` checks Node version, PATH, every provider CLI's presence + version, and env vars. It works even when MCP can't start. Follow the failed-check remediation in the report.

```bash
ask-llm doctor                       # human-readable
ask-llm doctor --json                # established full JSON, exit 1 on error
ask-llm doctor --format toon         # bounded, versioned agent-facing TOON pilot
ask-llm doctor --format toon --full  # full TOON escape hatch
```

After a global install, use `ask-llm doctor` for host and provider states. The optional `--live` check may spend provider quota; see [Doctor output formats](https://github.com/Lykhoyda/ask-llm/blob/main/packages/llm-mcp/README.md#doctor-output-formats) for the state meanings and output formats.

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
ollama pull qwen3.8:27b
```

Verify:

```bash
gemini --version    # or: which gemini
codex --version
ollama list
```

If `ask-llm doctor` reports a CLI as "not found on PATH" but `which <cli>` works in your terminal, the issue is PATH inheritance; see the next entry.

</TroubleshootingModal>

<TroubleshootingModal
  title='"PATH issue": CLI works in terminal but MCP server says "not found"'
  preview="macOS GUI apps don't inherit your shell PATH"
>

macOS GUI applications (Claude Desktop, Cursor, etc.) don't source `.zshrc` / `.bashrc`, so nvm / Homebrew / Volta paths aren't visible to the MCP server. Ask LLM resolves this automatically by extracting the real PATH from your login shell at startup.

If it's still failing:

1. Confirm `ask-llm doctor` shows a non-empty `Resolved PATH` with the CLI's directory in it.
2. If it doesn't, set `ASK_LLM_PATH` explicitly in your MCP client's env config:

```json
{
  "mcpServers": {
    "ask-llm": {
      "command": "/absolute/path/to/ask-llm-mcp",
      "args": [],
      "env": {
        "ASK_LLM_PATH": "/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/v24.0.0/bin"
      }
    }
  }
}
```

3. Restart your MCP client completely (not just reload).

</TroubleshootingModal>

<TroubleshootingModal
  title="MCP server not responding (Claude Desktop cannot connect)"
  preview="Server fails to start or connection drops"
>

**Step-by-step:**

1. **Check Node.js version**: must be ≥ v24:
   ```bash
   node --version
   ```
2. **Run the doctor** to identify what's missing:
   ```bash
   ask-llm doctor
   ```
3. **Verify Claude Desktop config syntax**: use a JSON validator. Common bugs: trailing commas, missing brackets.
4. **Restart Claude Desktop completely**:
   - Quit (Cmd+Q on Mac), wait 5s, reopen.
   - Just reloading the window is not enough.
5. **Check logs** for the actual error:
   - macOS: `~/Library/Logs/Claude/mcp-server-*.log`
   - Linux: `~/.config/claude/logs/`

</TroubleshootingModal>

<TroubleshootingModal
  title='EUNSUPPORTEDPROTOCOL workspace:* in an earlier npx registration'
  preview='An earlier cached installation can fail before the server starts'
>

Earlier cache-based registrations can contain stale package metadata. Use [Migration](/reference/migration) to replace a verified old entry with the durable installed path. Preserve customised environment variables and filters first. Primary onboarding does not depend on an npx server cache.

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

**The executor handles this automatically**: Gemini falls back from `gemini-3.1-pro-preview` to `gemini-3.8-flash`, and Codex falls back from `gpt-6-astra` to `gpt-5.6-terra`. You'll see `usage.fellBack: true` in the structured response.

If both Pro and Flash (or both GPT-6 Astra and Terra) hit quota, the call fails with both errors surfaced. Wait for the quota window to reset, or:

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

Ask LLM detects available providers at startup. If a provider you expected isn't there:

1. Run `ask-llm doctor` to see what it detects.
2. The most common cause is PATH not finding the provider CLI; see the PATH issue entry above.
3. For Ollama specifically, it must be **running** at `http://localhost:11434` (or wherever `OLLAMA_HOST` points). Not just installed.
4. Restart your MCP client to re-detect providers.

</TroubleshootingModal>

<TroubleshootingModal
  title='"Sub-agent silently produces 0-byte output" / brainstorm coordinator hang'
  preview="Provider process killed by sub-agent lifecycle"
>

This is a known bug class: Claude Code sub-agents can't own background processes that outlive their turn, so `(cmd &) && wait` patterns or `run_in_background: true` on dispatch calls cause processes to be SIGKILLed silently.

The brainstorm-coordinator agent uses the correct pattern (single foreground blocking Bash with direct backgrounding + per-PID wait + `timeout: 600000`). If you're seeing this in custom skills you're writing, follow the same pattern; see the agent prompt in `packages/llm-mcp/agents/brainstorm-coordinator.md` for the canonical template.

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

If `ask-llm` is missing, run `ask-llm setup --host claude`, follow its guidance, and fully restart Claude Code. Inspect `/mcp` after restart. The Claude adapter bundles Codex; setup also connects the user-scoped server for other providers.

If the registration is present but disconnected, run `ask-llm doctor`. A missing registration, disconnected service, and an older schema have different remediation. The review workflow discloses any CLI fallback. Legacy installation commands are retained in [Migration](/reference/migration#earlier-installation-recipes).

</TroubleshootingModal>

## Debug Mode

Enable verbose logging:

```json
{
  "mcpServers": {
    "ask-llm": {
      "command": "/absolute/path/to/ask-llm-mcp",
      "args": [],
      "env": {
        "GMCPT_LOG_LEVEL": "debug"
      }
    }
  }
}
```

Logs go to stderr. Claude Desktop captures them in:

- macOS: `~/Library/Logs/Claude/mcp-server-*.log`
- Linux: `~/.config/claude/logs/`

## Getting Help

1. **Run the doctor first**: `ask-llm doctor`
2. Check [GitHub Issues](https://github.com/Lykhoyda/ask-llm/issues) for similar reports
3. Open a new issue with: doctor output, your client (Claude Code/Desktop/Cursor/etc.), Node version, OS, and what you ran
4. Ask in [GitHub Discussions](https://github.com/Lykhoyda/ask-llm/discussions) for usage questions
