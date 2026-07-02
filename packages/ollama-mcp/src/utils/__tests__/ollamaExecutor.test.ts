import { responseCache } from "@ask-llm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, DEFAULT_BASE_URL, MODELS } from "../../constants.js";

vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return {
    ...actual,
    Logger: {
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { executeOllamaCLI, isProviderAvailable, listModels } from "../ollamaExecutor.js";

function okResponse(content: string, model?: string): Response {
  return new Response(
    JSON.stringify({
      model: model ?? MODELS.DEFAULT,
      message: { role: "assistant", content },
      done: true,
      prompt_eval_count: 100,
      eval_count: 50,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function errorResponse(status: number, errorText: string): Response {
  return new Response(JSON.stringify({ error: errorText }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  responseCache.clear();
  delete process.env.OLLAMA_HOST;
  mockFetch.mockImplementation(() => Promise.resolve(okResponse("Test response")));
});

describe("request construction", () => {
  it("sends POST to /api/chat with default model", async () => {
    await executeOllamaCLI({ prompt: "hello" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BASE_URL}${API.CHAT}`);
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.model).toBe(MODELS.DEFAULT);
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(body.stream).toBe(false);
  });

  it("uses custom model when specified", async () => {
    await executeOllamaCLI({ prompt: "hello", model: "llama3.2" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("llama3.2");
  });

  it("uses OLLAMA_HOST env var when set", async () => {
    process.env.OLLAMA_HOST = "http://remote:1234";
    await executeOllamaCLI({ prompt: "hello" });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://remote:1234/api/chat");
  });

  it("strips trailing slash from OLLAMA_HOST", async () => {
    process.env.OLLAMA_HOST = "http://remote:1234/";
    await executeOllamaCLI({ prompt: "hello" });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://remote:1234/api/chat");
  });
});

describe("response parsing", () => {
  it("extracts message.content from successful response", async () => {
    const result = await executeOllamaCLI({ prompt: "test" });
    expect(result.response).toContain("Test response");
  });

  it("appends stats footer with token counts", async () => {
    const result = await executeOllamaCLI({ prompt: "test" });
    expect(result.response).toContain("100 input tokens");
    expect(result.response).toContain("50 output tokens");
    expect(result.response).toContain(`model: ${MODELS.DEFAULT}`);
  });

  it("returns actual model name from response", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(okResponse("content", "custom-model:latest")));

    const result = await executeOllamaCLI({ prompt: "test" });
    expect(result.model).toBe("custom-model:latest");
  });

  it("handles empty content gracefully", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ model: MODELS.DEFAULT, message: { content: "" }, done: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await executeOllamaCLI({ prompt: "test" });
    expect(result.response).toBeTruthy();
  });
});

describe("model-not-found handling (no fallback)", () => {
  it("throws an actionable 'ollama pull' error on 'not found', without retrying", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(errorResponse(404, "model 'qwen3.6:27b' not found, try pulling it first")),
    );

    await expect(executeOllamaCLI({ prompt: "test", model: "qwen3.6:27b" })).rejects.toThrow(
      /ollama pull qwen3\.6:27b/,
    );
    // Exactly one request — no substitution to a different model.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("names the default model in the error when no model is specified", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(errorResponse(404, "model not found, try pulling it first")),
    );

    await expect(executeOllamaCLI({ prompt: "test" })).rejects.toThrow(new RegExp(`ollama pull ${MODELS.DEFAULT}`));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry on non-model errors (500)", async () => {
    mockFetch.mockImplementationOnce(() => Promise.resolve(errorResponse(500, "internal server error")));

    await expect(executeOllamaCLI({ prompt: "test" })).rejects.toThrow("internal server error");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("server unreachable", () => {
  it("throws descriptive error on network failure", async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new TypeError("fetch failed")));

    await expect(executeOllamaCLI({ prompt: "test" })).rejects.toThrow("Ollama server is not reachable");
  });
});

describe("response caching", () => {
  it("returns cached response on second identical call", async () => {
    await executeOllamaCLI({ prompt: "cached prompt" });
    const result = await executeOllamaCLI({ prompt: "cached prompt" });

    expect(result.response).toContain("Test response");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("cache miss triggers new HTTP request", async () => {
    await executeOllamaCLI({ prompt: "first" });
    await executeOllamaCLI({ prompt: "second" });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("cache key differs for different models", async () => {
    await executeOllamaCLI({ prompt: "test", model: "model-a" });
    await executeOllamaCLI({ prompt: "test", model: "model-b" });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("onProgress callback", () => {
  it("calls onProgress with content preview after response", async () => {
    const onProgress = vi.fn();
    await executeOllamaCLI({ prompt: "test", onProgress });

    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining("Test response"));
  });
});

describe("isProviderAvailable", () => {
  it("returns true when /api/tags responds 200", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 })),
    );

    const available = await isProviderAvailable();
    expect(available).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      `${DEFAULT_BASE_URL}${API.TAGS}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns false on network error", async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error("ECONNREFUSED")));

    const available = await isProviderAvailable();
    expect(available).toBe(false);
  });

  it("uses custom base URL when provided", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 })),
    );

    await isProviderAvailable("http://custom:5555");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://custom:5555/api/tags");
  });
});

describe("listModels", () => {
  it("returns model names from /api/tags response", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ models: [{ name: "llama3.2:latest" }, { name: "qwen2.5-coder:7b" }] }), {
          status: 200,
        }),
      ),
    );

    const models = await listModels();
    expect(models).toEqual(["llama3.2:latest", "qwen2.5-coder:7b"]);
  });

  it("returns empty array on failure", async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error("ECONNREFUSED")));

    const models = await listModels();
    expect(models).toEqual([]);
  });
});

describe("chat timeout", () => {
  it("passes an abort signal to the chat request", async () => {
    await executeOllamaCLI({ prompt: "signal test" });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toEqual(expect.any(AbortSignal));
  });

  it("aborts a stalled chat request with an actionable error naming ASK_OLLAMA_TIMEOUT_MS", async () => {
    process.env.ASK_OLLAMA_TIMEOUT_MS = "30";
    try {
      mockFetch.mockImplementationOnce(
        (_url: string, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () =>
              reject(new DOMException("This operation was aborted", "AbortError")),
            );
          }),
      );

      await expect(executeOllamaCLI({ prompt: "stalled" })).rejects.toThrow(
        /timed out after 30ms[\s\S]*ASK_OLLAMA_TIMEOUT_MS/,
      );
    } finally {
      delete process.env.ASK_OLLAMA_TIMEOUT_MS;
    }
  });
});

describe("session UX (ADR-063 fix for empty-string sessionId)", () => {
  it("undefined sessionId hits the response cache (cache enabled by default)", async () => {
    responseCache.clear();
    mockFetch.mockImplementation(() => Promise.resolve(okResponse("hi")));

    await executeOllamaCLI({ prompt: "p" });
    await executeOllamaCLI({ prompt: "p" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("empty-string sessionId DISABLES the cache so a fresh session can be created each call", async () => {
    responseCache.clear();
    mockFetch.mockImplementation(() => Promise.resolve(okResponse("hi")));

    await executeOllamaCLI({ prompt: "p", sessionId: "" });
    await executeOllamaCLI({ prompt: "p", sessionId: "" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
