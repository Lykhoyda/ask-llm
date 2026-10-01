import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";

const extension = vi.hoisted(() => vi.fn());
vi.mock("@ask-llm/mcp/pi", () => ({ default: extension }));

import askLlmBridge from "../../pi/index.js";

it("delegates to the canonical extension without registering package skill discovery", () => {
  const on = vi.fn();
  const pi = { on } as unknown as ExtensionAPI;

  askLlmBridge(pi);

  expect(extension).toHaveBeenCalledExactlyOnceWith(pi);
  expect(on).not.toHaveBeenCalled();
});
