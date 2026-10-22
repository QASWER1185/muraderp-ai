import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../config/env.js")>();
  return { ...original, env: { ...original.env, INTERNAL_API_TOKEN: "test-session-signing-secret-32-characters" } };
});

import { env } from "../config/env.js";
import { browserSessionHandler } from "../auth/browser-session.js";
import { apiKeyAuth, createApiKeyAuth } from "./apiKeyAuth.js";
import { createCopilotAuth } from "./copilot-auth.js";
import { createInternalApiAuth } from "./internal-api-auth.js";

const userId = "11111111-1111-4111-8111-111111111111";
const API_KEY = "test-murad-api-key-with-sufficient-entropy";
const defaults = {
  organizationId: "60460719-45f4-4d9b-9fa1-3d81d35ed302",
  branchId: "c57e64ed-da40-40f6-b038-a55e869184b9",
  actorUserId: "ec309eef-0405-4b83-9836-1e757b30abf5",
};

function sessionCookie(): string {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  const signature = createHmac("sha256", env.INTERNAL_API_TOKEN!).update(payload).digest("base64url");
  return `muraderp_session=${payload}.${signature}`;
}

function appForAuthenticationTest(auth: typeof apiKeyAuth = apiKeyAuth) {
  const app = express();
  app.use("/api/copilot", createCopilotAuth(undefined, "api-key-test-service"));
  app.use("/api/v1", auth);
  app.use("/api/v1/test", createCopilotAuth(undefined, "api-key-test-service"), (req, res) => {
    res.status(200).json({ authenticated: true, servicePrincipalId: req.servicePrincipal?.id, userId: req.browserPrincipal?.userId });
  });
  app.get("/api/v1/internal-test", createInternalApiAuth(env.INTERNAL_API_TOKEN, "api-key-test-service"), (req, res) => {
    res.status(200).json({ authenticated: true, servicePrincipalId: req.servicePrincipal?.id });
  });
  app.get("/api/v1/session-bound", browserSessionHandler(true), (req, res) => res.status(200).json({ userId: req.browserPrincipal?.userId }));
  app.get("/api/v1/tenant-context", (req, res) => res.status(200).json({
    organizationId: req.header("X-Organization-Id"),
    branchId: req.header("X-Branch-Id"),
    actorUserId: req.header("X-Actor-User-Id"),
    transactionContext: req.apiKeyTenantContext,
  }));
  app.use("/api/copilot/test", (_req, res) => res.status(200).json({ authenticated: true }));
  return app;
}

afterEach(() => vi.unstubAllEnvs());

describe("versioned API key authentication", () => {
  it("accepts a valid X-API-Key for a versioned business route", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const response = await request(appForAuthenticationTest()).get("/api/v1/internal-test").set("X-API-Key", API_KEY)
      .set("X-Organization-Id", defaults.organizationId).set("X-Branch-Id", defaults.branchId).set("X-Actor-User-Id", defaults.actorUserId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ authenticated: true, servicePrincipalId: "api-key-test-service" });
  });

  it("trims configured and incoming API keys", async () => {
    vi.stubEnv("MURAD_API_KEY", `  ${API_KEY}\r\n`);
    const response = await request(appForAuthenticationTest()).get("/api/v1/internal-test")
      .set("X-API-Key", `  ${API_KEY}  `)
      .set("X-Organization-Id", defaults.organizationId).set("X-Branch-Id", defaults.branchId).set("X-Actor-User-Id", defaults.actorUserId);
    expect(response.status).toBe(200);
  });

  it("accepts the API key in a Bearer header and fills default tenant context", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const loadDefaultContext = vi.fn().mockResolvedValue(defaults);
    const response = await request(appForAuthenticationTest(createApiKeyAuth(loadDefaultContext)))
      .get("/api/v1/tenant-context").set("Authorization", `Bearer ${API_KEY}`);
    expect(response.status).toBe(200);
    expect(loadDefaultContext).toHaveBeenCalledOnce();
    expect(response.body).toEqual({ ...defaults, transactionContext: defaults });
  });

  it("fills missing tenant headers from the primary context for key-only requests", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const loadDefaultContext = vi.fn().mockResolvedValue(defaults);
    const response = await request(appForAuthenticationTest(createApiKeyAuth(loadDefaultContext)))
      .get("/api/v1/tenant-context").set("X-API-Key", API_KEY);
    expect(response.status).toBe(200);
    expect(loadDefaultContext).toHaveBeenCalledOnce();
    expect(response.body).toEqual({ ...defaults, transactionContext: defaults });
  });

  it("preserves caller context headers and does not load defaults when all are present", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const defaults = vi.fn();
    const context = {
      organizationId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      actorUserId: userId,
    };
    const response = await request(appForAuthenticationTest(createApiKeyAuth(defaults)))
      .get("/api/v1/tenant-context").set("X-API-Key", API_KEY)
      .set("X-Organization-Id", context.organizationId).set("X-Branch-Id", context.branchId).set("X-Actor-User-Id", context.actorUserId);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...context, transactionContext: context });
    expect(defaults).not.toHaveBeenCalled();
  });

  it("rejects an invalid API key when no valid browser session is present", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const response = await request(appForAuthenticationTest()).get("/api/v1/internal-test").set("X-API-Key", "incorrect-key");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid API key" });
  });

  it("rejects an unknown Bearer credential without falling through to browser sessions", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const response = await request(appForAuthenticationTest()).get("/api/v1/internal-test")
      .set("Authorization", "Bearer incorrect-key").set("Cookie", sessionCookie());
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid API key" });
  });

  it("allows the configured internal bearer token to use its existing service-auth path", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const response = await request(appForAuthenticationTest()).get("/api/v1/internal-test")
      .set("Authorization", `Bearer ${env.INTERNAL_API_TOKEN}`);
    expect(response.status).toBe(200);
  });

  it("continues to accept existing signed browser sessions", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const response = await request(appForAuthenticationTest()).get("/api/v1/test").set("Cookie", sessionCookie());
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ authenticated: true, userId });
  });

  it("allows API-key auth through session-bound versioned middleware with an explicit actor", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const response = await request(appForAuthenticationTest()).get("/api/v1/session-bound")
      .set("X-API-Key", API_KEY).set("X-Actor-User-Id", userId)
      .set("X-Organization-Id", defaults.organizationId).set("X-Branch-Id", defaults.branchId);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId });
  });

  it("does not apply the versioned API key to /api/copilot", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const response = await request(appForAuthenticationTest()).get("/api/copilot/test").set("X-API-Key", API_KEY);
    expect(response.status).toBe(401);
  });
});
