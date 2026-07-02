import { PROVIDERS as CANONICAL_PROVIDERS } from "@ask-llm/shared";
import { describe, expect, it } from "vitest";
import { INSTALL_HINTS, PROVIDERS } from "../constants.js";

describe("provider registry drift guard", () => {
  it("registry keys exactly match the canonical shared PROVIDERS list", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([...CANONICAL_PROVIDERS].sort());
  });

  it("every provider has an install hint", () => {
    expect(Object.keys(INSTALL_HINTS).sort()).toEqual([...CANONICAL_PROVIDERS].sort());
  });
});
