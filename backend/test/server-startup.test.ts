import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = undefined;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("production server startup", () => {
  it("listens on port 8080 without OPENAI_API_KEY", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PORT", "8080");
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", `sb_secret_${"x".repeat(40)}`);
    vi.stubEnv("INTERNAL_API_TOKEN", "t".repeat(64));
    vi.stubEnv("INTERNAL_API_PRINCIPAL_ID", "muraderp-api-prod-01");

    const { startServer } = await import("../src/server.js");
    server = startServer();
    if (!server.listening) await new Promise<void>((resolve) => server?.once("listening", resolve));

    const response = await fetch("http://127.0.0.1:8080/api/v1/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  }, 15_000);
});
