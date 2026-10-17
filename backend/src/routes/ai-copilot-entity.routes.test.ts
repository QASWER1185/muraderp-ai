import { createHmac, randomBytes } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
vi.mock("../config/env.js", async importOriginal => {
  const original = await importOriginal<typeof import("../config/env.js")>();
  return { ...original, env: { ...original.env, INTERNAL_API_TOKEN: randomBytes(32).toString("hex") } };
});
import { env } from "../config/env.js";
import { createAiCopilotRouter } from "./ai-copilot.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import { CopilotAgent } from "../ai-copilot/copilot-agent.js";
import { resolveCandidates } from "../services/entity-search.service.js";
import { businessFixture, scope, call, final } from "../ai-copilot/agent/business.test-fixtures.js";

function setup() {
  const f = businessFixture();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { info: vi.fn(), warn: vi.fn() } as any; next(); });
  app.use("/api/v1/ai/copilot", createAiCopilotRouter(env.INTERNAL_API_TOKEN, undefined, "service", new CopilotAgent(f.core), f.core, f.tools));
  app.use(errorHandler);
  const payload = Buffer.from(JSON.stringify({ userId: scope.userId, exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  const cookie = `muraderp_session=${payload}.${createHmac("sha256", env.INTERNAL_API_TOKEN!).update(payload).digest("base64url")}`;
  return { ...f, app, cookie };
}
const headers = { "X-Organization-Id": scope.organizationId, "X-Branch-Id": scope.branchId };

describe("Copilot HTTP missing-entity regression", () => {
  it.each(["agent", "chat"])("returns verified missing entities through /%s", async route => {
    const f = setup();
    vi.mocked(f.services.search.searchProducts).mockResolvedValue(resolveCandidates([], 5));
    vi.mocked(f.services.search.searchCustomers).mockResolvedValue(resolveCandidates([], 5));
    f.script(call("query_inventory", { query: "cement" }), call("query_customer_ledger", { query: "Hamdan Sahib" }), final("invented balance 999"));
    const result = await request(f.app).post(`/api/v1/ai/copilot/${route}`).set(headers).set("Cookie", f.cookie)
      .send({ message: "Check cement stock and Hamdan Sahib ledger balance", ...(route === "chat" ? { organizationId: scope.organizationId } : {}) });
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    const answer = result.body.data.answer ?? result.body.data.message;
    expect(answer).toContain("Customer 'Hamdan Sahib' was not found");
    expect(answer).toContain("Product 'cement' was not found");
    expect(answer).not.toMatch(/could not verify|999/);
    expect(result.body.requiresConfirmation).toBe(false);
    expect(f.business.erp.listCustomers).toHaveBeenCalledWith({ limit: 5 }, scope.organizationId);
    expect(f.business.repository.customerLedger).not.toHaveBeenCalled();
    expect(f.erpWrite).not.toHaveBeenCalled();
  });

  it("returns an authorization failure without reading suggestions or ledger data", async () => {
    const f = setup();
    f.gateway.hasPermission.mockResolvedValue(false);
    f.script(call("query_customer_ledger", { query: "Hamdan Sahib" }));
    const result = await request(f.app).post("/api/v1/ai/copilot/agent").set(headers).set("Cookie", f.cookie).send({ message: "Hamdan Sahib ledger" });
    expect(result.status).toBe(403);
    expect(f.business.erp.listCustomers).not.toHaveBeenCalled();
    expect(f.business.repository.customerLedger).not.toHaveBeenCalled();
  });
});
