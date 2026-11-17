// Keep the complete core contract within hosts' first 512 characters.
export const SERVER_INSTRUCTIONS =
  'Ask LLM tools provide second opinions from other models. For reviews and edit proposals, the other model reads and proposes; the host applies edits. Calls can take several minutes; wait for completion. Reuse the returned sessionId to continue a supported thread; for Codex, pass sessionId: "" on the first call to persist it. Use an explicitly writable tool for file creation.';
