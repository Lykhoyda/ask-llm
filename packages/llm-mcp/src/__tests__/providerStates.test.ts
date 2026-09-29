import { afterEach, describe, expect, it, vi } from "vitest";
import { localProviderStates } from "../utils/providerStates.js";

const installed = { cliPath: "/bin/tool", available: true, pathEnv: "/nonexistent" };
const missing = { cliPath: undefined, available: false, pathEnv: "/nonexistent" };

function runner(result: { code: number; stdout?: string; stderr?: string }) {
  return vi.fn(async (_command: string, _args: string[], _pathEnv: string) => ({ stdout: "", stderr: "", ...result }));
}

afterEach(() => vi.unstubAllEnvs());

describe("localProviderStates", () => {
  it.each([
    [{ code: 0, stderr: "Logged in using ChatGPT" }, "yes"],
    [{ code: 1, stderr: "Not logged in" }, "no"],
    [{ code: 9, stderr: "boom" }, "unknown"],
  ] as const)("maps codex login status %j to authenticated=%s", async (result, authenticated) => {
    const run = runner(result);
    const states = await localProviderStates("codex", installed, run);
    expect(states).toEqual({ installed: "yes", authenticated, permitted: "yes" });
    expect(run).toHaveBeenCalledWith("codex", ["login", "status"], "/nonexistent");
  });

  it.each([
    [{ code: 0, stdout: '{"loggedIn": true}', stderr: "warning" }, "yes"],
    [{ code: 1, stdout: '{"loggedIn": false}' }, "no"],
    [{ code: 9, stderr: "unknown command" }, "unknown"],
  ] as const)("maps claude auth status %j to authenticated=%s", async (result, authenticated) => {
    const run = runner(result);
    expect(await localProviderStates("claude", installed, run)).toMatchObject({ authenticated });
    expect(run).toHaveBeenCalledWith("claude", ["auth", "status"], "/nonexistent");
  });

  it("does not probe auth for a CLI that is not installed", async () => {
    const run = runner({ code: 0 });
    expect(await localProviderStates("codex", missing, run)).toEqual({
      installed: "no",
      authenticated: "unknown",
      permitted: "yes",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("permits Antigravity only with the explicit unisolated opt-in and never guesses its auth", async () => {
    const run = runner({ code: 0 });
    vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", "");
    expect(await localProviderStates("antigravity", installed, run)).toEqual({
      installed: "yes",
      authenticated: "unknown",
      permitted: "no",
    });
    vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", "1");
    expect(await localProviderStates("antigravity", installed, run)).toMatchObject({ permitted: "yes" });
    expect(run).not.toHaveBeenCalled();
  });

  it("reads Gemini and Grok API keys as authenticated, otherwise unknown", async () => {
    const run = runner({ code: 0 });
    vi.stubEnv("ASK_GROK_HARNESS", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("XAI_API_KEY", "");
    expect(await localProviderStates("gemini", installed, run)).toMatchObject({ authenticated: "unknown" });
    expect(await localProviderStates("grok", { ...missing, available: true }, run)).toEqual({
      installed: "no",
      authenticated: "unknown",
      permitted: "yes",
    });
    vi.stubEnv("GEMINI_API_KEY", "set");
    vi.stubEnv("XAI_API_KEY", "set");
    expect(await localProviderStates("gemini", installed, run)).toMatchObject({ authenticated: "yes" });
    expect(await localProviderStates("grok", { ...missing, available: true }, run)).toEqual({
      installed: "not-required",
      authenticated: "yes",
      permitted: "yes",
    });
    vi.stubEnv("ASK_GROK_HARNESS", "grok-cli");
    expect(await localProviderStates("grok", { ...missing, available: true }, run)).toEqual({
      installed: "no",
      authenticated: "unknown",
      permitted: "yes",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("marks Ollama authentication as not required", async () => {
    expect(await localProviderStates("ollama", missing, runner({ code: 0 }))).toEqual({
      installed: "no",
      authenticated: "not-required",
      permitted: "yes",
    });
  });
});
