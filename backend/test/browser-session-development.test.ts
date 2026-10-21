import express from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const configuration = vi.hoisted(() => ({ NODE_ENV: "development", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "test-only-secret", INTERNAL_API_TOKEN: undefined as string | undefined }));
const getUser = vi.hoisted(() => vi.fn());
vi.mock("../src/config/env.js", () => ({ env: configuration }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser } }) }));
import { authRouter } from "../src/routes/auth.routes.js";
import { errorHandler } from "../src/middleware/error-handler.js";

function app() {
  const server = express();
  server.use(pinoHttp({ enabled: false }), express.json());
  server.use("/auth", authRouter);
  server.use(errorHandler);
  return server;
}
afterEach(() => { configuration.NODE_ENV = "development"; configuration.INTERNAL_API_TOKEN = undefined; getUser.mockReset(); });

describe("development browser session signing", () => {
  it("exchanges a verified Supabase user for a signed local session without an internal token", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "verified-user" } }, error: null });
    const server = app();
    const created = await request(server).post("/auth/session").send({ accessToken: "test-only-supabase-access-token" });
    expect(created.status).toBe(200);
    const cookies = created.headers["set-cookie"] as unknown as string[];
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).not.toContain("Secure");
    const read = await request(server).get("/auth/session").set("Cookie", cookies);
    expect(read.status).toBe(200);
    expect(read.body.data.userId).toBe("verified-user");
    expect(getUser).toHaveBeenCalledWith("test-only-supabase-access-token");
  });
  it("rejects forged and missing sessions rather than bypassing authentication", async () => {
    const server = app();
    expect((await request(server).get("/auth/session")).status).toBe(401);
    expect((await request(server).get("/auth/session").set("Cookie", "muraderp_session=forged.invalid")).status).toBe(401);
  });
  it("still requires Supabase to verify the user before issuing any cookie", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    const result = await request(app()).post("/auth/session").send({ accessToken: "test-only-expired-access-token" });
    expect(result.status).toBe(401);
    expect(result.headers["set-cookie"]).toBeUndefined();
  });
  it("never falls back to a development secret in production", async () => {
    configuration.NODE_ENV = "production";
    const result = await request(app()).get("/auth/session").set("Cookie", "muraderp_session=forged.invalid");
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe("AUTH_NOT_CONFIGURED");
  });
});
