import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createAiCopilotRouter } from "./ai-copilot.routes.js";
import { errorHandler } from "../middleware/error-handler.js";

const organizationId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
const userId = "11111111-1111-4111-8111-111111111111";
const token = "local-test-token-with-at-least-thirty-two-characters";

function appWithAgent() {
  const agent = { respond: vi.fn(async () => ({ message: "Live rate is PKR 320 per length.", toolNames: ["search_products", "get_rate"] })) };
  const app = express();
  app.use(express.json());
  app.use("/api/v1/ai/copilot", createAiCopilotRouter(token, undefined, "local-test-copilot", agent as any));
  app.use(errorHandler);
  return { app, agent };
}

describe("Copilot chat route", () => {
  it("denies an unauthenticated request before reaching the agent", async () => {
    const { app, agent } = appWithAgent();
    const result = await request(app).post("/api/v1/ai/copilot/chat").set("X-Branch-Id", branchId)
      .send({ organizationId, userId, message: "pipe 25mm rate" });
    expect(result.status).toBe(401);
    expect(agent.respond).not.toHaveBeenCalled();
  });

  it("forwards authenticated tenant context and returns a read answer without a draft", async () => {
    const { app, agent } = appWithAgent();
    const result = await request(app).post("/api/v1/ai/copilot/chat")
      .set("Authorization", `Bearer ${token}`).set("X-Branch-Id", branchId)
      .send({ organizationId, userId, message: "pipe 25mm rate" });
    expect(result.status).toBe(200);
    expect(result.body.requiresConfirmation).toBe(false);
    expect(result.body.data.message).toContain("PKR 320");
    expect(agent.respond).toHaveBeenCalledWith("pipe 25mm rate", { userId, organizationId, branchId });
  });
});
