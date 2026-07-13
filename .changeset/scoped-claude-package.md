---
"@anton-lykhoyda/ask-claude-mcp": patch
"ask-llm-mcp": patch
---

Publish the Claude provider under the `@anton-lykhoyda` npm scope because npm
rejects the unscoped name as too similar to an existing package. The executable
remains `ask-claude-mcp`, and the unified server now imports the scoped package.
