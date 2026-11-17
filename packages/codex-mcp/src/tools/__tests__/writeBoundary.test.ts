import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../../utils/codexExecutor.js", () => ({
  executeCodexCLI: vi.fn().mockResolvedValue({ response: "ok", threadId: "thread" }),
  processCodexEditOutput: vi.fn(),
}));

import { executeCodexCLI } from "../../utils/codexExecutor.js";
import { askCodexTool } from "../ask-codex.tool.js";
import { askCodexWriteTool } from "../ask-codex-write.tool.js";
import { executeTool } from "../index.js";

beforeEach(() => vi.clearAllMocks());

it("rejects workspace-write on ask-codex before executing", async () => {
  await expect(executeTool("ask-codex", { prompt: "write", sandbox: "workspace-write" })).rejects.toThrow(
    /Invalid arguments/,
  );
  expect(executeCodexCLI).not.toHaveBeenCalled();
});

it("forces read-only even when the tool is called directly with unvalidated arguments", async () => {
  await askCodexTool.execute({ prompt: "review", sandbox: "workspace-write" });
  expect(executeCodexCLI).toHaveBeenCalledWith(expect.objectContaining({ sandbox: "read-only" }));
});

it("advertises write access and executes the separate write tool with workspace-write", async () => {
  expect(askCodexWriteTool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  expect(askCodexTool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  const result = await executeTool("ask-codex-write", { prompt: "create image" });
  expect(executeCodexCLI).toHaveBeenCalledWith(expect.objectContaining({ sandbox: "workspace-write" }));
  expect(
    askCodexWriteTool.outputSchema?.safeParse(typeof result === "string" ? undefined : result.structuredContent)
      .success,
  ).toBe(true);
  expect(askCodexWriteTool.zodSchema.safeParse({ prompt: "p", sandbox: "read-only" }).success).toBe(false);
});
