import { afterEach, describe, expect, it, vi } from "vitest";
import { googleRouteCheck, localProviderStates } from "../utils/providerStates.js";

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

  it.each(["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_APPLICATION_CREDENTIALS"])(
    "keeps Gemini authentication unknown with %s present",
    async (name) => {
      const run = runner({ code: 0 });
      vi.stubEnv(name, "fake-value");
      expect(await localProviderStates("gemini", installed, run)).toEqual({
        installed: "yes",
        authenticated: "unknown",
        permitted: "yes",
      });
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("uses API-key presence for Grok API authentication only", async () => {
    const run = runner({ code: 0 });
    vi.stubEnv("ASK_GROK_HARNESS", "");
    vi.stubEnv("XAI_API_KEY", "");
    expect(await localProviderStates("grok", { ...missing, available: true }, run)).toEqual({
      installed: "no",
      authenticated: "unknown",
      permitted: "yes",
    });
    vi.stubEnv("XAI_API_KEY", "set");
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

describe("Google route checks", () => {
  it.each([
    ["gemini", "GEMINI_API_KEY"],
    ["gemini", "GOOGLE_API_KEY"],
    ["gemini", "GOOGLE_GENAI_USE_VERTEXAI"],
    ["gemini", "GOOGLE_APPLICATION_CREDENTIALS"],
    ["antigravity", "AGY_ADC_AUTH"],
    ["antigravity", "GEMINI_API_KEY"],
  ])("warns for %s with %s present without accessing any values", (key, name) => {
    const env = new Proxy(
      { [name]: "" },
      {
        get: () => {
          throw new Error("doctor accessed an environment value");
        },
      },
    );
    expect(googleRouteCheck(key, key, env)).toMatchObject({
      status: "warn",
      message: expect.stringContaining(`${name} present. Possible alternate billing.`),
    });
  });

  it.each(["gemini", "antigravity"])("leaves %s seat and funding unproven on project names alone", (key) => {
    const check = googleRouteCheck(key, key, {
      GOOGLE_CLOUD_PROJECT: "synthetic-project",
      GOOGLE_CLOUD_PROJECT_ID: "synthetic-project-id",
    });
    expect(check).toMatchObject({
      status: "skip",
      message:
        "Project variables only (GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_PROJECT_ID). Google route and funding unverified. Seat unproven.",
    });
    expect(check?.fix).toContain("Cached Cloud or pay-as-you-go");
  });

  it("treats AGY_ADC_AUTH as an Antigravity-only signal and shows the consumer-plan boundary", () => {
    const env = { AGY_ADC_AUTH: "fake-value" };
    expect(googleRouteCheck("gemini", "Gemini", env)).toMatchObject({ status: "skip" });
    expect(googleRouteCheck("antigravity", "Antigravity", env)).toMatchObject({
      status: "warn",
      fix: expect.stringContaining("consumer-plan support"),
    });
  });
});
