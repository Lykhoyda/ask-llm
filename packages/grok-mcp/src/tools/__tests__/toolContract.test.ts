import { responseCache } from "@ask-llm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FACTORY_DEFAULT_MODEL } from "../../constants.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { toolRegistry } from "../index.js";

beforeEach(() => {
  vi.clearAllMocks();
  responseCache.clear();
  process.env.XAI_API_KEY = "xai-tool-fixture-not-real";
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        status: "completed",
        model: FACTORY_DEFAULT_MODEL,
        output: [{ type: "message", content: [{ type: "output_text", text: "reviewed" }] }],
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
      { status: 200 },
    ),
  );
});

describe("Grok provider contract", () => {
  it("registers the consultation and diagnostic tools", () => {
    expect(toolRegistry.map((tool) => tool.name).sort()).toEqual(["ask-grok", "ping"]);
  });

  it("advertises the exact factory model and standard AskResponse output", () => {
    const tool = toolRegistry.find((entry) => entry.name === "ask-grok");
    expect(tool?.description).toContain(FACTORY_DEFAULT_MODEL);
    expect(tool?.description).toContain("never enables billing");
    expect(tool?.outputSchema).toBeDefined();
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });

  it("returns truthful structured provider, model, and usage metadata", async () => {
    const tool = toolRegistry.find((entry) => entry.name === "ask-grok");
    const result = await tool?.execute({ prompt: "review" });
    expect(result).not.toBeTypeOf("string");
    if (!result || typeof result === "string") throw new Error("expected structured result");
    expect(result.structuredContent).toMatchObject({
      provider: "grok",
      model: FACTORY_DEFAULT_MODEL,
      usage: { provider: "grok", model: FACTORY_DEFAULT_MODEL, fellBack: false },
      harness: "xai-api",
    });
  });

  it("forwards cancellation to the HTTP transport", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const tool = toolRegistry.find((entry) => entry.name === "ask-grok");
    const pending = tool?.execute({ prompt: "review" }, undefined, undefined, controller.signal);
    controller.abort(new DOMException("tool cancelled", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError", message: "tool cancelled" });
  });
});
