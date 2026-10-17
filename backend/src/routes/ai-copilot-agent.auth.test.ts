import { createHmac, randomBytes } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ReadOnlyCopilotAgent } from "../ai-copilot/agent/agent.js";

vi.mock("../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../config/env.js")>();
  const { randomBytes } = await import("node:crypto");
  return { ...original, env: { ...original.env, INTERNAL_API_TOKEN: randomBytes(32).toString("hex") } };
});
import { env } from "../config/env.js";
import { createAiCopilotRouter } from "./ai-copilot.routes.js";
import { errorHandler } from "../middleware/error-handler.js";

const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
function setup() {
  const run = vi.fn(async () => ({ answer: "Verified", status: "completed" }));
  const app = express(); app.use(express.json());
  app.use((request, _response, next) => {
    request.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as typeof request.log;
    next();
  });
  app.use("/copilot", createAiCopilotRouter(env.INTERNAL_API_TOKEN, undefined, "test-agent-service", undefined, { run } as unknown as ReadOnlyCopilotAgent));
  app.use(errorHandler);
  const body = Buffer.from(JSON.stringify({ userId, exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  const cookie = `muraderp_session=${body}.${createHmac("sha256", env.INTERNAL_API_TOKEN!).update(body).digest("base64url")}`;
  return { app, run, cookie };
}

describe("Phase 1 browser authentication boundary", () => {
  it("rejects anonymous, forged-cookie, and internal-only requests", async () => {
    const { app, run } = setup();
    for (const headers of [{}, { Cookie: "muraderp_session=forged.invalid" }, { Authorization: `Bearer ${env.INTERNAL_API_TOKEN}` }]) {
      const response = await request(app).post("/copilot/agent").set(headers).set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId).send({ message: "Pipe" });
      expect(response.status).toBe(401);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("takes identity from the signed browser session and rejects client-supplied authority", async () => {
    const { app, run, cookie } = setup();
    const send = (body: object) => request(app).post("/copilot/agent").set("Cookie", cookie).set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId).set("X-User-Id", randomBytes(16).toString("hex")).send(body);
    expect((await send({ message: "Pipe", userId: "someone-else" })).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
    expect((await send({ message: "Pipe" })).status).toBe(200);
    expect(run).toHaveBeenCalledWith({ message: "Pipe" }, { userId, organizationId, branchId }, expect.any(Object));
    const missingScope = await request(app).post("/copilot/agent").set("Cookie", cookie).send({ message: "Pipe" });
    expect(missingScope.status).toBe(400);
    expect(run).toHaveBeenCalledOnce();
  });
});
