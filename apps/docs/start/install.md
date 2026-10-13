---
description: Connect your coding assistant to a second reviewer using your existing model accounts.
---

# Install

Get a second opinion on your code or plan, inside your coding assistant, using the model subscriptions you already have.

## Before you start

Use Node.js 24+ on Linux or macOS. You need a coding assistant and at least one other provider installed and signed in. Ask LLM configures their connection; it does not install providers or sign you in. See [authentication](/operation/authentication) if your provider is not ready.

## Install and connect

<SetupTabs />

Setup discovers hosts separately from providers. Select the assistant you want to use, review the command or file preview, and confirm each change. Setup works at user scope, preserves unrelated entries, and prints backup locations and restart instructions. It also previews workflow installation. Pairing remains off.

Follow any manual guidance in the output before continuing. Existing Codex registrations require manual inspection because the host's inventory does not prove user-scope ownership. Antigravity needs the printed workflow-copy step. OpenCode registration is tested with fixtures only. See [host compatibility](/compatibility/hosts) and [migration](/reference/migration).

Start a new session in your project or restart your assistant, then [ask for your first review](/start/first-review).

## Preview without changing anything

```bash
ask-llm setup --dry-run
```

To target just one assistant, use `ask-llm setup --host claude` (or another [host ID](/reference/cli#host-ids)). Running setup again preserves compatible registrations and refreshes changed workflows.

If no supported assistant is found, use [manual configuration](/advanced/manual-configuration). If setup fails, run `ask-llm doctor` and use [troubleshooting](/resources/troubleshooting).
