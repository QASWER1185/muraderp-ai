import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ReadOnlyCopilotAgent } from "../ai-copilot/agent/agent.js";
import type { AiProviderContract } from "../ai/providers/contracts.js";
import { errorHandler } from "../middleware/error-handler.js";
import { pinoHttp } from "pino-http";
import { ApiError } from "../errors/api-error.js";

vi.mock("../middleware/copilot-auth.js", () => ({
  createCopilotAuth: () => (request: { browserPrincipal?: { userId: string } }, _response: unknown, next: () => void) => {
    request.browserPrincipal = { userId: "11111111-1111-4111-8111-111111111111" };
    next();
  },
}));

import { createAiCopilotRouter } from "./ai-copilot.routes.js";

describe("Phase 1 agent route on the production backend baseline", () => {
  it.each(["header", "payload", "both"])("sanitizes %s credentials and never passes keys into the agent", async source => {
    const key = "test-only-gemini-key-123456789";
    const run = vi.fn(async (_input: unknown) => ({answer:"Verified",status:"completed"}));
    const provider = {name:"gemini"} as AiProviderContract;
    const providerFactory = vi.fn(() => provider);
    const agentFactory = vi.fn(() => ({run}) as unknown as ReadOnlyCopilotAgent);
    const app = express(); app.use(express.json());
    app.use("/copilot",createAiCopilotRouter(undefined,undefined,undefined,undefined,undefined,undefined,undefined,providerFactory,agentFactory));
    app.use(errorHandler);
    let send = request(app).post("/copilot/agent").set("X-Organization-Id","22222222-2222-4222-8222-222222222222").set("X-Branch-Id","33333333-3333-4333-8333-333333333333");
    if (source !== "payload") send = send.set("X-Api-Key",`  ${key}  `);
    const response = await send.send({message:"ledger",...(source === "header" ? {} : {apiKey:source === "both" ? "ignored-payload-credential-123456789" : `  ${key}\n`})});
    expect(response.status).toBe(200);
    expect(providerFactory).toHaveBeenCalledWith(key);
    expect(run.mock.calls[0]![0]).toEqual({message:"ledger"});
    expect(JSON.stringify(response.body)).not.toContain(key);
  });
  it.each([42,"test-only-gemini-key\nheader-control"])("rejects malformed payload credentials without invoking a model", async apiKey => {
    const providerFactory = vi.fn();
    const app = express(); app.use(pinoHttp({enabled:false}),express.json());
    app.use("/copilot",createAiCopilotRouter(undefined,undefined,undefined,undefined,undefined,undefined,undefined,providerFactory));
    app.use(errorHandler);
    const response = await request(app).post("/copilot/settings/test").send({apiKey});
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("AI_API_KEY_INVALID");
    expect(providerFactory).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain(String(apiKey));
  });
  it("tests the saved provider key without ERP tools and only reports success after a real text response", async () => {
    const toolTurn = vi.fn().mockResolvedValue({ output: [{ type: "message", content: [{type:"output_text",text:"READY"}] }] });
    const providerFactory = vi.fn(() => ({ toolTurn }) as unknown as AiProviderContract);
    const app = express(); app.use(pinoHttp({enabled:false}), express.json());
    app.use("/copilot", createAiCopilotRouter(undefined, undefined, undefined, undefined, undefined, undefined, undefined, providerFactory));
    app.use(errorHandler);
    const send = () => request(app).post("/copilot/settings/test").set("X-Api-Key", "test-only-gemini-key-123456789").set("X-AI-Provider", "gemini").send({});
    const success = await send();
    expect(success.status).toBe(200);
    expect(success.body).toEqual({ data: { connected: true } });
    expect(providerFactory).toHaveBeenCalledWith("test-only-gemini-key-123456789", expect.any(Function));
    expect(toolTurn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), [], expect.objectContaining({signal:expect.any(AbortSignal)}));
    toolTurn.mockRejectedValueOnce(new ApiError(401, "AI_API_KEY_REJECTED", "The AI provider rejected this API key."));
    const rejected = await send();
    expect(rejected.status).toBe(401);
    expect(rejected.body.error.code).toBe("AI_API_KEY_REJECTED");
    expect(JSON.stringify(rejected.body)).not.toContain("test-only-gemini-key");
  });
  it("supports the canonical and compatibility Copilot root endpoints with the same authentication and tenant scope", async () => {
    const run = vi.fn(async () => ({ answer: "Verified inventory", status: "completed" }));
    const app = express(); app.use(express.json());
    app.use(["/api/v1/ai/copilot", "/api/copilot"], createAiCopilotRouter(undefined, undefined, undefined, undefined, { run } as unknown as ReadOnlyCopilotAgent));
    for (const path of ["/api/v1/ai/copilot", "/api/copilot"]) {
      const response = await request(app).post(path).set("X-Organization-Id", "22222222-2222-4222-8222-222222222222").set("X-Branch-Id", "33333333-3333-4333-8333-333333333333").send({ message: "Check cement stock" });
      expect(response.status).toBe(200); expect(response.body.data.answer).toBe("Verified inventory");
    }
    expect(run).toHaveBeenCalledTimes(2);
  });
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
