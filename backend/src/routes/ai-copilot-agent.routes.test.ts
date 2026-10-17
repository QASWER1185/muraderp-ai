import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ReadOnlyCopilotAgent } from "../ai-copilot/agent/agent.js";
import type { AiProviderContract } from "../ai/providers/contracts.js";
import { errorHandler } from "../middleware/error-handler.js";

vi.mock("../middleware/copilot-auth.js", () => ({
  createCopilotAuth: () => (request: { browserPrincipal?: { userId: string } }, _response: unknown, next: () => void) => {
    request.browserPrincipal = { userId: "11111111-1111-4111-8111-111111111111" };
    next();
  },
}));

import { createAiCopilotRouter } from "./ai-copilot.routes.js";

describe("Phase 1 agent route on the production backend baseline", () => {
  it("passes the signed conversation token and authenticated tenant scope to the agent", async () => {
    const result = { answer: "Verified rate", conversationToken: "new-signed-context", traceId: "trace-1", status: "completed" };
    const run = vi.fn(async () => result);
    const app = express();
    app.use(express.json());
    app.use("/api/v1/ai/copilot", createAiCopilotRouter(undefined, undefined, undefined, undefined, { run } as unknown as ReadOnlyCopilotAgent));
    app.use(errorHandler);

    const response = await request(app).post("/api/v1/ai/copilot/agent")
      .set("X-Organization-Id", "22222222-2222-4222-8222-222222222222")
      .set("X-Branch-Id", "33333333-3333-4333-8333-333333333333")
      .send({ message: "اس کا موجودہ سیل ریٹ بتاؤ، مقدار 1 میٹر", conversationToken: "previous-signed-context" });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(result);
    expect(run).toHaveBeenCalledWith(
      { message: "اس کا موجودہ سیل ریٹ بتاؤ، مقدار 1 میٹر", conversationToken: "previous-signed-context" },
      {
        userId: "11111111-1111-4111-8111-111111111111",
        organizationId: "22222222-2222-4222-8222-222222222222",
        branchId: "33333333-3333-4333-8333-333333333333",
      },
      undefined,
    );
  });

  it("uses the authenticated user's Gemini key for the request without changing the server agent", async () => {
    const key = "AIzaSyTestOnlyKey012345678901234567";
    const result = { answer: "Pipe stock is verified", conversationToken: "new-context", conversationId: "44444444-4444-4444-8444-444444444444", status: "completed" };
    const run = vi.fn(async () => result);
    const requestProvider = { name: "gemini", toolTurn: vi.fn() };
    const providerFactory = vi.fn((_key: string) => requestProvider as unknown as AiProviderContract);
    const requestAgent = { run };
    const requestAgentFactory = vi.fn(() => requestAgent as unknown as ReadOnlyCopilotAgent);
    const app = express();
    app.use(express.json());
    app.use("/api/v1/ai/copilot", createAiCopilotRouter(undefined, undefined, undefined, undefined, undefined, undefined, undefined, providerFactory, requestAgentFactory));
    app.use(errorHandler);

    const response = await request(app).post("/api/v1/ai/copilot/agent")
      .set("X-Api-Key", key).set("X-AI-Provider", "gemini")
      .set("X-Organization-Id", "22222222-2222-4222-8222-222222222222")
      .set("X-Branch-Id", "33333333-3333-4333-8333-333333333333")
      .send({ message: "Pipe stock" });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(result);
    expect(providerFactory).toHaveBeenCalledWith(key);
    expect(requestAgentFactory).toHaveBeenCalledWith(requestProvider);
    expect(run).toHaveBeenCalledOnce();
  });

  it("reports server-side key availability without disclosing configuration", async () => {
    const app = express();
    app.use("/api/v1/ai/copilot", createAiCopilotRouter());
    app.use(errorHandler);
    const response = await request(app).get("/api/v1/ai/copilot/settings");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ serverConfigured: expect.any(Boolean) });
    expect(JSON.stringify(response.body)).not.toMatch(/apiKey|provider|model/i);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
