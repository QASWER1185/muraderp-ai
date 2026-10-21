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
import { apiKeyAuth } from "./apiKeyAuth.js";
import { createCopilotAuth } from "./copilot-auth.js";
import { createInternalApiAuth } from "./internal-api-auth.js";

const userId = "11111111-1111-4111-8111-111111111111";
const API_KEY = "test-murad-api-key-with-sufficient-entropy";

function sessionCookie(): string {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  const signature = createHmac("sha256", env.INTERNAL_API_TOKEN!).update(payload).digest("base64url");
  return `muraderp_session=${payload}.${signature}`;
}

function appForAuthenticationTest() {
  const app = express();
  app.use("/api/copilot", createCopilotAuth(undefined, "api-key-test-service"));
  app.use("/api/v1", apiKeyAuth);
  app.use("/api/v1/test", createCopilotAuth(undefined, "api-key-test-service"), (req, res) => {
    res.status(200).json({ authenticated: true, servicePrincipalId: req.servicePrincipal?.id, userId: req.browserPrincipal?.userId });
  });
  app.get("/api/v1/internal-test", createInternalApiAuth("test-internal-api-token", "api-key-test-service"), (req, res) => {
    res.status(200).json({ authenticated: true, servicePrincipalId: req.servicePrincipal?.id });
  });
  app.get("/api/v1/session-bound", browserSessionHandler(true), (req, res) => res.status(200).json({ userId: req.browserPrincipal?.userId }));
  app.use("/api/copilot/test", (_req, res) => res.status(200).json({ authenticated: true }));
  return app;
}

afterEach(() => vi.unstubAllEnvs());

describe("versioned API key authentication", () => {
  it("accepts a valid X-API-Key for a versioned business route", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const response = await request(appForAuthenticationTest()).get("/api/v1/internal-test").set("X-API-Key", API_KEY);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ authenticated: true, servicePrincipalId: "api-key-test-service" });
  });

  it("rejects an invalid API key when no valid browser session is present", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const response = await request(appForAuthenticationTest()).get("/api/v1/internal-test").set("X-API-Key", "incorrect-key");
    expect(response.status).toBe(401);
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
      .set("X-API-Key", API_KEY).set("X-Actor-User-Id", userId);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId });
  });

  it("does not apply the versioned API key to /api/copilot", async () => {
    vi.stubEnv("MURAD_API_KEY", API_KEY);
    const response = await request(appForAuthenticationTest()).get("/api/copilot/test").set("X-API-Key", API_KEY);
    expect(response.status).toBe(401);
  });
});
