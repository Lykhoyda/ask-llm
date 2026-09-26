import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../logger.js";

const realNode = process.versions.node;

function fakeNode(version: string) {
  Object.defineProperty(process.versions, "node", { value: version, configurable: true });
}

describe("Logger.checkNodeVersion", () => {
  afterEach(() => {
    fakeNode(realNode);
    vi.restoreAllMocks();
  });

  it("warns below the Node 24 LTS floor by default", () => {
    const error = vi.spyOn(Logger, "error").mockImplementation(() => {});
    fakeNode("22.18.0");
    Logger.checkNodeVersion();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("v24+ required"));
  });

  it("stays quiet on Node 24", () => {
    const error = vi.spyOn(Logger, "error").mockImplementation(() => {});
    fakeNode("24.0.0");
    Logger.checkNodeVersion();
    expect(error).not.toHaveBeenCalled();
  });
});
