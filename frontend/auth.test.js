import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseConfiguration } from "./supabase-config.js";
import { signIn } from "./auth.js";
import { boundedFetch } from "./request.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("hosted authentication bootstrap", () => {
  it.each([undefined, {}, { url: "" }, { url: "http://localhost:54321" }])("uses the healthy hosted project when public configuration is absent or partial", config => {
    expect(supabaseConfiguration(config)).toMatchObject({ url: "https://pmsowmiivjkwtovynhje.supabase.co", key: expect.stringMatching(/^sb_publishable_/) });
  });
  it("does not expose a server secret through browser configuration", () => {
    expect(() => supabaseConfiguration({ url: "https://project.supabase.co", key: "sb_secret_private" })).toThrow("public Supabase key");
  });
  it("submits the exact password and establishes the ERP session without persisting the token", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "test-access-token", user: { id: "user" } }) }).mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetch);
    await signIn("owner@example.com", " password with spaces ");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ email: "owner@example.com", password: " password with spaces " });
    expect(fetch.mock.calls[0][0]).toBe("https://pmsowmiivjkwtovynhje.supabase.co/auth/v1/token?grant_type=password");
    expect(fetch.mock.calls[1][1]).toMatchObject({ credentials: "include", headers: { Authorization: "Bearer test-access-token" } });
  });
  it("terminates a stalled request with a recoverable timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))));
    const result = expect(boundedFetch("/api/v1/workspaces", {}, 10)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10);
    await result;
  });
});
