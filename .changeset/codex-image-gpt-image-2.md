---
"@ask-llm/plugin": patch
---

codex-image skill: correct the image model to `gpt-image-2`. OpenAI shipped gpt-image-2 on 2026-04-21 (replacing gpt-image-1 and the interim 1.5), and Codex's server-side `image_generation` tool now uses it — verified via the C2PA provenance manifest embedded in a live render (`gpt-image` version `2.0`). Updated the SKILL.md description + example footer, and refreshed the stale "2–6 minutes" wall-time to sub-minute for simple images (measured 44–52s; a few minutes for complex/4K thinking-mode renders).
