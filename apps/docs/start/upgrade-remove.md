---
description: Refresh your installation or reverse the registrations Ask LLM owns.
---

# Upgrade and remove

## Upgrade

Repeat the install line from [Install](/start/install), then restart the host. Setup preserves compatible registrations and refreshes changed workflows. It previews replacements for earlier registrations and leaves customised entries with guidance; see [migration](/reference/migration).

## Remove registrations

```bash
ask-llm remove
```

Inspect the preview and confirm. Removal deletes only registrations whose command resolves to this installation's server. Codex receives manual guidance when ownership cannot be verified. Removal does not restore replaced or retired entries.

The Claude Code workflows and portable skills remain installed. Removal prints the separate commands to remove them; inspect the named workflows before running those commands. Shared skill removal can affect several hosts reading the same folder. User-owned pairing logs, cache and consent remain until you explicitly remove or revoke them.

For Pi's setup-managed local package, use the source path shown by `pi list` with `pi remove <installed package directory>`. Earlier Pi npm installations remain unchanged and need the [migration guidance](/reference/migration).

After removing registrations and any workflows you no longer want, uninstall the global installation with npm. The exact package name is in the [install line](/start/install). Backups remain beside the host's config; they may contain credentials and retain the original file permissions (or owner-only permissions if those could not be read).
