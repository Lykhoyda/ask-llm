import { responseCache } from "@ask-llm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, FACTORY_DEFAULT_MODEL, FACTORY_DEFAULT_REASONING_EFFORT, XAI_API_BASE_URL } from "../../constants.js";

vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return {
    ...actual,
    Logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { executeGrokAPI, isProviderAvailable, listModels } from "../grokExecutor.js";

const API_KEY = "xai-fixture-key-not-real";

function successResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: "resp_fixture",
      object: "response",
      status: "completed",
      model: FACTORY_DEFAULT_MODEL,
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "Independent Grok answer" }],
        },
      ],
      usage: {
        input_tokens: 120,
        output_tokens: 45,
        total_tokens: 165,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens_details: { reasoning_tokens: 12 },
      },
      ...overrides,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function apiError(status: number, error: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  responseCache.clear();
  process.env.XAI_API_KEY = API_KEY;
  delete process.env.ASK_GROK_MODEL;
  delete process.env.ASK_GROK_REASONING_EFFORT;
  delete process.env.ASK_GROK_TIMEOUT_MS;
  delete process.env.ASK_GROK_MAX_OUTPUT_TOKENS;
  fetchMock.mockImplementation(() => Promise.resolve(successResponse()));
});

describe("xAI Responses API request", () => {
  it("uses the documented endpoint, exact default model, disabled storage, and high reasoning", async () => {
    await executeGrokAPI({ prompt: "review this" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${XAI_API_BASE_URL}${API.RESPONSES}`);
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: FACTORY_DEFAULT_MODEL,
      input: "review this",
      store: false,
      max_output_tokens: 16384,
      reasoning: { effort: FACTORY_DEFAULT_REASONING_EFFORT },
    });
  });

  it("passes a requested model byte-for-byte without rewriting or retrying", async () => {
    const requested = "fixture-exact-model";
    fetchMock.mockResolvedValueOnce(successResponse({ model: requested }));

    const result = await executeGrokAPI({ prompt: "review", model: requested });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);

    expect(body.model).toBe(requested);
    expect(result.model).toBe(requested);
    expect(result.usage.fellBack).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies a bounded output cap and validates explicit overrides before transport", async () => {
    process.env.ASK_GROK_MAX_OUTPUT_TOKENS = "4096";
    await executeGrokAPI({ prompt: "bounded" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).max_output_tokens).toBe(4096);

    process.env.ASK_GROK_MAX_OUTPUT_TOKENS = "unlimited";
    await expect(executeGrokAPI({ prompt: "invalid cap" })).rejects.toThrow(/must be an integer/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the configured reasoning effort without encoding it into the model ID", async () => {
    await executeGrokAPI({ prompt: "hard problem", reasoningEffort: "xhigh" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);

    expect(body.model).toBe(FACTORY_DEFAULT_MODEL);
    expect(body.reasoning).toEqual({ effort: "xhigh" });
  });

  it("rejects an invalid reasoning effort before network I/O", async () => {
    process.env.ASK_GROK_REASONING_EFFORT = "maximum";
    await expect(executeGrokAPI({ prompt: "test" })).rejects.toThrow(/Use one of: low, medium, high, xhigh/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a JSON Schema through Responses API text.format and bypasses response caching", async () => {
    const outputSchema = {
      type: "object",
      properties: { verdict: { type: "string" } },
      required: ["verdict"],
      additionalProperties: false,
    };

    await executeGrokAPI({ prompt: "structured", outputSchema });
    await executeGrokAPI({ prompt: "structured", outputSchema });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);

    expect(body.text).toEqual({
      format: {
        type: "json_schema",
        name: "ask_llm_response",
        strict: true,
        schema: outputSchema,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("response contract", () => {
  it("returns actual provider model and normalized token telemetry", async () => {
    const result = await executeGrokAPI({ prompt: "telemetry" });

    expect(result.model).toBe(FACTORY_DEFAULT_MODEL);
    expect(result.response).toContain("Independent Grok answer");
    expect(result.usage).toMatchObject({
      provider: "grok",
      model: FACTORY_DEFAULT_MODEL,
      inputTokens: 120,
      outputTokens: 45,
      cachedTokens: 20,
      thinkingTokens: 12,
      fellBack: false,
    });
    expect(result.response).toContain("12 thinking");
  });

  it("reports and discloses the model returned by xAI when it differs from the requested alias", async () => {
    fetchMock.mockResolvedValueOnce(successResponse({ model: "fixture-resolved-model" }));
    const onProgress = vi.fn();
    const result = await executeGrokAPI({ prompt: "alias", onProgress });
    expect(result.model).toBe("fixture-resolved-model");
    expect(result.reportedModel).toBe("fixture-resolved-model");
    expect(result.usage.model).toBe("fixture-resolved-model");
    expect(result.usage.fellBack).toBe(false);
    expect(onProgress).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`served model "fixture-resolved-model" for requested "${FACTORY_DEFAULT_MODEL}"`),
      ),
    );
  });

  it("stays silent about model resolution when xAI serves the requested ID", async () => {
    const onProgress = vi.fn();
    const result = await executeGrokAPI({ prompt: "same", onProgress });
    expect(result.reportedModel).toBe(FACTORY_DEFAULT_MODEL);
    expect(onProgress.mock.calls.flat().join(" ")).not.toMatch(/served model/);
  });

  it("keeps the requested model effective but leaves reportedModel empty when the payload omits model", async () => {
    fetchMock.mockResolvedValueOnce(successResponse({ model: undefined }));
    const result = await executeGrokAPI({ prompt: "no model", model: "grok-4.6" });
    expect(result).toMatchObject({ model: "grok-4.6", reportedModel: undefined });
    expect(result.usage.model).toBe("grok-4.6");
  });

  it("discloses that xhigh is applied as high on models without xhigh support", async () => {
    const onProgress = vi.fn();
    await executeGrokAPI({ prompt: "deep", reasoningEffort: "xhigh", onProgress });
    expect(onProgress).toHaveBeenCalledWith(expect.stringMatching(/xhigh.*applies it as high.*docs\.x\.ai/));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).reasoning).toEqual({ effort: "xhigh" });

    onProgress.mockClear();
    await executeGrokAPI({ prompt: "deep-high", reasoningEffort: "high", onProgress });
    expect(onProgress.mock.calls.flat().join(" ")).not.toMatch(/xhigh/);
  });

  it("surfaces a typed safety refusal and does not retry", async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "refusal", refusal: "Cannot assist with that request" }],
          },
        ],
      }),
    );

    await expect(executeGrokAPI({ prompt: "unsafe" })).rejects.toThrow(/Grok refused.*No fallback/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects incomplete responses actionably", async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
    );
    await expect(executeGrokAPI({ prompt: "long" })).rejects.toThrow(/incomplete.*max_output_tokens.*No fallback/);
  });

  it("rejects malformed JSON and empty output with stable diagnostics", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    await expect(executeGrokAPI({ prompt: "bad json" })).rejects.toThrow(/malformed response/);

    fetchMock.mockResolvedValueOnce(successResponse({ output: [] }));
    await expect(executeGrokAPI({ prompt: "empty" })).rejects.toThrow(/malformed response/);
  });
});

describe("credential, model, quota, and transport diagnostics", () => {
  it("fails before transport when credentials are missing", async () => {
    delete process.env.XAI_API_KEY;
    await expect(executeGrokAPI({ prompt: "test" })).rejects.toThrow(/Set XAI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])("normalizes HTTP %s as invalid xAI credentials", async (status) => {
    fetchMock.mockResolvedValueOnce(apiError(status, { message: `invalid key ${API_KEY}` }));
    await expect(executeGrokAPI({ prompt: "test" })).rejects.toThrow(/Grok authentication failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes unsupported models without substituting", async () => {
    fetchMock.mockResolvedValueOnce(apiError(404, { code: "model_not_found", message: "unknown" }));
    await expect(executeGrokAPI({ prompt: "test", model: "grok-does-not-exist" })).rejects.toThrow(
      /model "grok-does-not-exist".*GET https:\/\/api\.x\.ai\/v1\/models.*No fallback/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([402, 429])("normalizes HTTP %s as exhausted quota or rate limits", async (status) => {
    fetchMock.mockResolvedValueOnce(apiError(status, { code: "rate_limit_exceeded", message: "limit" }));
    await expect(executeGrokAPI({ prompt: "test" })).rejects.toThrow(
      /quota, credits, or rate limit.*does not.*fall back/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a 4xx that rejects the reasoning effort without changing model or effort", async () => {
    fetchMock.mockResolvedValueOnce(
      apiError(400, { code: "invalid_request", message: "reasoning.effort 'xhigh' is not supported for this model" }),
    );
    const message = await executeGrokAPI({ prompt: "test", model: "fixture-model", reasoningEffort: "xhigh" }).catch(
      (error: Error) => error.message,
    );
    expect(message).toMatch(/model "fixture-model" rejected reasoning effort "xhigh" with HTTP 400/);
    expect(message).toMatch(/low, medium, high, xhigh/);
    expect(message).toMatch(/ASK_GROK_REASONING_EFFORT/);
    expect(message).toMatch(/docs\.x\.ai.*reasoning/);
    expect(message).toMatch(/no fallback was attempted/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a generic 4xx without effort wording on the model/schema diagnostic", async () => {
    fetchMock.mockResolvedValueOnce(apiError(400, { code: "invalid_request", message: "schema is invalid" }));
    await expect(executeGrokAPI({ prompt: "test" })).rejects.toThrow(/Check the exact model ID and JSON Schema/);
  });

  it("normalizes safety errors returned before generation", async () => {
    fetchMock.mockResolvedValueOnce(apiError(400, { code: "content_policy", message: "safety violation" }));
    await expect(executeGrokAPI({ prompt: "test" })).rejects.toThrow(/Grok refused.*No fallback/);
  });

  it("normalizes service and network failures without exposing the API key", async () => {
    fetchMock.mockResolvedValueOnce(apiError(503, { message: `upstream failed for ${API_KEY}` }));
    const serviceError = await executeGrokAPI({ prompt: "service" }).catch((error: Error) => error.message);
    expect(serviceError).toContain("HTTP 503");
    expect(serviceError).not.toContain(API_KEY);

    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed with ${API_KEY}`));
    const networkError = await executeGrokAPI({ prompt: "network" }).catch((error: Error) => error.message);
    expect(networkError).toContain("transport failed before receiving");
    expect(networkError).not.toContain(API_KEY);
  });
});

describe("cancellation and timeout", () => {
  it("aborts the underlying request and preserves the caller cancellation", async () => {
    const caller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );

    const pending = executeGrokAPI({ prompt: "cancel", signal: caller.signal });
    caller.abort(new DOMException("consultation cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError", message: "consultation cancelled" });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("times out and aborts the underlying request", async () => {
    process.env.ASK_GROK_TIMEOUT_MS = "25";
    let transportSignal: AbortSignal | null = null;
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          transportSignal = init.signal ?? null;
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );

    await expect(executeGrokAPI({ prompt: "timeout" })).rejects.toThrow(
      /timed out after 25ms.*ASK_GROK_TIMEOUT_MS.*underlying HTTP request was aborted/,
    );
    expect(transportSignal?.aborted).toBe(true);
  });
});

describe("model discovery and caching", () => {
  it("detects configuration without a paid inference or network call", async () => {
    expect(await isProviderAvailable()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    delete process.env.XAI_API_KEY;
    expect(await isProviderAvailable()).toBe(false);
  });

  it("lists exact model IDs using the unbilled model endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "grok-4.6" }, { id: "fixture-exact-model" }] }), { status: 200 }),
    );
    await expect(listModels()).resolves.toEqual(["grok-4.6", "fixture-exact-model"]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${XAI_API_BASE_URL}${API.MODELS}`,
      expect.objectContaining({ headers: { Authorization: `Bearer ${API_KEY}` }, signal: expect.any(AbortSignal) }),
    );
  });

  it("serves a cached consultation with the API-returned model but without re-countable usage", async () => {
    fetchMock.mockResolvedValueOnce(successResponse({ model: "fixture-resolved-model" }));
    const first = await executeGrokAPI({ prompt: "alias cache" });
    const second = await executeGrokAPI({ prompt: "alias cache" });

    expect(first.usage).toMatchObject({ provider: "grok", model: "fixture-resolved-model", inputTokens: 120 });
    expect(second).toMatchObject({
      model: "fixture-resolved-model",
      reportedModel: "fixture-resolved-model",
      response: first.response,
      usage: undefined,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("caches only identical unstructured requests with the same effort", async () => {
    await executeGrokAPI({ prompt: "cached", reasoningEffort: "low" });
    await executeGrokAPI({ prompt: "cached", reasoningEffort: "low" });
    await executeGrokAPI({ prompt: "cached", reasoningEffort: "high" });
    process.env.ASK_GROK_MAX_OUTPUT_TOKENS = "4096";
    await executeGrokAPI({ prompt: "cached", reasoningEffort: "high" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
