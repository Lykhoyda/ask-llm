---
name: codex-image
description: Generate an image via OpenAI's gpt-image-2 model through the Codex CLI. Use when user asks to "generate an image", "create an image", "make a picture of", "render a graphic", "draw something", or wants visual content via Codex. Requires codex-cli >= 0.125.0 with the `image_generation` feature flag enabled (stable + on-by-default since 0.125).
user_invocable: true
---

# Codex Image Generation

Generate an image by delegating to the `ask-codex` MCP tool with a prompt-engineered template that triggers Codex's built-in `image_generation` tool. The result is saved to disk and the path is returned to the user.

## Prerequisites

- `codex-cli` >= 0.125.0 installed and authenticated
- `image_generation` feature flag enabled (default: stable + true). Verify with `codex features list | grep image_generation`
- The `ask-codex` MCP tool available (from `ask-codex-mcp` or the `ask-llm-mcp` orchestrator)

## Instructions

### Phase 1: Build the image prompt

Take the user's natural-language ask and prepare it for image generation. Rules:

- **Keep the user's intent intact** — do not change meaning. Refine, don't replace.
- **If the prompt is sparse** (e.g., "an apple") AND the surrounding conversation has design context (e.g., a LinkedIn post, an article), enrich with that context: aspect ratio, style cues, what to avoid.
- **If the prompt is already detailed**, send it through verbatim — the user knows what they want.
- **Default exclusions worth adding**: "no humanoid figures, no glowing brains, no chatbot iconography" if the topic is AI / LLM-related (these are diffusion-model failure modes and the user will almost certainly want them excluded).

If you significantly enrich the prompt, briefly tell the user what you added and let them push back before dispatching.

### Phase 2: Determine output path

Convention:

- **Default path**: `/tmp/codex-images/$(date +%Y-%m-%d)/<slug>.png` where `<slug>` is a short kebab-case derivation from the user's prompt (max 40 chars).
- **Override**: if the user explicitly provided an output path (absolute or relative), use that exactly.
- **Ensure parent directory exists** — `mkdir -p <parent>` before dispatching. Codex's image tool will fail if the directory doesn't exist.

Example slug derivation:
- "Generate an image of a dark terminal with two reviewers" → `dark-terminal-with-two-reviewers.png`
- "Make me a cat picture" → `cat-picture.png`

### Phase 3: Dispatch to ask-codex

Call the `ask-codex` MCP tool (NOT raw `codex exec` — that bypasses ADR-044 quota fallback, ADR-042 stdin handling, and ADR-047 PATH resolution). Use this prompt template:

```
Use your image_generation tool to create the following image and save it as a PNG file.

Image description:
<the user's prompt, refined per Phase 1>

Save the file to this absolute path: <path from Phase 2>

After saving, confirm the absolute path of the created file and its byte size in your reply. If image_generation fails or the file cannot be written, explain what went wrong and do not invent a fake path.
```

**Default model:** let `ask-codex` use its default (`gpt-5.5`, per ADR-067). The image_generation tool is invoked by the model regardless of which Codex chat model is selected — model selection here is about the orchestrating agent, not the image model itself.

**Wall time expectation:** with gpt-image-2, simple images typically render in **under a minute** end-to-end; complex prompts or high-resolution (up to 4K) renders can take a **few minutes** because gpt-image-2's thinking mode plans layout and self-checks before generating. This is normal; do not retry assuming a hang. The first call in a session is slowest because the image_generation tool definitions aren't cached yet; subsequent calls in the same session are faster (Codex CLI prompt-caches aggressively).

### Phase 4: Verify and present

After `ask-codex` returns:

1. **Run `ls -la <path>`** to confirm the file was created. Do not trust the agent's textual claim alone.
2. **If file exists**: report the absolute path, byte size, and Codex's response footer (model, sessionId, usage). If the user's environment supports inline image rendering (most Claude Code clients do via the Read tool), Read the image so the user can see it.
3. **If file missing**: surface Codex's reply verbatim (it usually contains the failure reason — e.g., "image generation rejected the prompt for policy reasons", "feature flag disabled", "quota exceeded"). Do NOT silently retry — tell the user and let them decide.

### Phase 5: Failure modes worth catching specifically

- **`image_generation` flag disabled**: `codex features list | grep image_generation` shows `false`. Tell the user to enable it: `codex features enable image_generation` or `codex --enable image_generation [PROMPT]`.
- **Codex CLI version too old**: `codex --version` < 0.125.0. Tell the user to update: `npm i -g @openai/codex` (or whichever install method they use).
- **Prompt rejected by content policy**: Codex's reply will include policy language. Show it verbatim — do not paraphrase or apologize. Let the user revise.
- **Disk full / permission denied on output path**: report the path and the OS error verbatim; suggest a different `outputPath`.

## Example interaction

User: `/codex-image generate a minimalist illustration of a cat reading a book`

Phase 1 — refined prompt: *minimalist illustration of a cat reading a book, flat vector style, two-tone palette, no human figures, square framing, transparent background*

Phase 2 — output: `/tmp/codex-images/2026-04-24/cat-reading-a-book.png`

Phase 3 — `ask-codex` is called with the prompt template above.

Phase 4 — `ls -la /tmp/codex-images/2026-04-24/cat-reading-a-book.png` shows a 248KB file. Skill returns:

> Generated **/tmp/codex-images/2026-04-24/cat-reading-a-book.png** (248 KB) via gpt-image-2. Used Codex (gpt-5.5) as orchestrator. Refined prompt: *minimalist illustration of a cat reading a book, flat vector style, two-tone palette, no human figures, square framing, transparent background*. Reading inline below.

[image renders]
