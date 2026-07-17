# Token Overhead Benchmark

Static analysis of per-approach context-window overhead.
Generated: 2026-03-20T13:42:34.225Z

## Per-Tool Token Breakdown

| Tool | Description | Schema | Prompt | Annotations | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| ask-gemini | 63 | 467 | 32 | 42 | 604 |
| fetch-chunk | 25 | 126 | 57 | 34 | 242 |
| ping | 6 | 71 | 17 | 33 | 127 |
| ask-codex | 54 | 162 | 25 | 43 | 284 |
| ping | 6 | 71 | 17 | 33 | 127 |

## Markdown Context Files

| File | Tokens |
| --- | ---: |
| packages/claude-plugin/skills/gemini-review/SKILL.md | 156 |
| packages/claude-plugin/agents/gemini-reviewer.md | 301 |

## Per-Approach Token Overhead

| Approach | Tools | Tool Tokens | MD Tokens | Total Tokens |
| --- | ---: | ---: | ---: | ---: |
| Standalone Gemini (@ask-llm/gemini-mcp) | 3 | 973 | 0 | 973 |
| Standalone Codex (@ask-llm/codex-mcp) | 2 | 411 | 0 | 411 |
| Orchestrator (@ask-llm/mcp) | 5 | 1384 | 0 | 1384 |
| Skill (/gemini-review) | 3 | 973 | 457 | 1430 |
| Subagent (gemini-reviewer) | 3 | 973 | 301 | 1274 |

## Notes

- Tokenizer: `cl100k_base` (js-tiktoken) — close proxy for Claude's tokenizer
- Tool tokens include: description + JSON schema + prompt metadata + annotations
- Skill totals include the SKILL.md and agent .md loaded into the primary context
- Subagent total reflects the agent .md + tools available in the spawned subagent context
- Orchestrator registers both Gemini and Codex tools in a single server
