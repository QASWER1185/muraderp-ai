import { createHmac, randomBytes } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
vi.mock("../config/env.js", async importOriginal => {
  const original = await importOriginal<typeof import("../config/env.js")>();
  return { ...original, env: { ...original.env, INTERNAL_API_TOKEN: randomBytes(32).toString("hex") } };
});
import { env } from "../config/env.js";
import { CopilotAgent } from "../ai-copilot/copilot-agent.js";
import { newBusinessState, touchDraft, writeBusinessState, type BusinessState } from "../ai-copilot/agent/business-state.js";
import type { DraftView } from "../ai-copilot/agent/draft-tools.js";
import { fixture, scope, call, pipe, customer } from "../ai-copilot/agent/stateful.test-fixtures.js";
import { createAiCopilotRouter } from "./ai-copilot.routes.js";
import { errorHandler } from "../middleware/error-handler.js";

function setup() {
  const f = fixture();
  const runtime = {
    createConversationDraft: vi.fn(async (_state: BusinessState, _view: DraftView) => ({ id: "55555555-5555-4555-8555-555555555555", status: "DRAFT", idempotencyKey: "server-key" })),
    confirmAndExecute: vi.fn(async () => ({ status: "EXECUTED" })),
  };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.log = { info: vi.fn(), warn: vi.fn() } as any; next(); });
  app.use("/copilot", createAiCopilotRouter(env.INTERNAL_API_TOKEN, runtime as any, "test-service", new CopilotAgent(f.core), f.core, f.tools));
  app.use(errorHandler);
  const body = Buffer.from(JSON.stringify({ userId: scope.userId, exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  const cookie = `muraderp_session=${body}.${createHmac("sha256", env.INTERNAL_API_TOKEN!).update(body).digest("base64url")}`;
  const state = newBusinessState(scope);
  state.customer = customer; state.productContext = { candidates: [{ id: pipe.id, name: pipe.name, sku: pipe.sku, unit: pipe.unit }], ambiguous: false };
  const draft = touchDraft(state);
  draft.lines.push({ id: "66666666-6666-4666-8666-666666666666", productId: pipe.id, quantity: 20, unit: "MTR", discountPercent: 10 });
  draft.preparedRevision = draft.revision;
  return { f, app, runtime, cookie, state };
}
const headers = { "X-Organization-Id": scope.organizationId, "X-Branch-Id": scope.branchId };

describe("unified conversational HTTP and preparation safety", () => {
  it("continues the same signed draft across both Agent endpoints", async () => {
    const { f, app, cookie } = setup();
    f.script(call("lookup_customers", { query: "قاسم صاحب" }), call("begin_estimate_draft"));
    const first = await request(app).post("/copilot/agent").set(headers).set("Cookie", cookie).send({ message: "قاسم صاحب کے لیے estimate بناؤ" });
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    f.script(call("search_products", { query: "Popular pipe" }), call("add_draft_item", { quantity: 20 }));
    const second = await request(app).post("/copilot/chat").set(headers).set("Cookie", cookie).send({
      organizationId: scope.organizationId, message: "اس میں 20 میٹر pipe ڈال دو",
      conversationToken: first.body.data.conversationToken, conversationId: first.body.data.conversationId,
    });
    expect(second.status).toBe(200);
    expect(second.body.data.draft.id).toBe(first.body.data.draft.id);
    expect(second.body.data.draft.customer.id).toBe(19);
    expect(second.body.data.draft.totals.grand_total).toBe(9540);
  });

  it("prepares only an existing DRAFT action; requires a separate explicit confirmation", async () => {
    const { app, runtime, state, cookie } = setup();
    const response = await request(app).post("/copilot/conversation/drafts").set(headers).set("Cookie", cookie)
      .send({ conversationToken: writeBusinessState(state), conversationId: state.conversationId });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ requiresConfirmation: true, executed: false, data: { status: "DRAFT", idempotencyKey: "server-key" } });
    expect(response.body.draft).toMatchObject({ totals: { grand_total: 8586 }, lines: [{ rate: { unit_price: 477 } }] });
    expect(runtime.confirmAndExecute).not.toHaveBeenCalled();
    expect(runtime.createConversationDraft.mock.calls[0]?.[1]).toMatchObject({ totals: { grand_total: 8586 } });
    const confirmed = await request(app).post("/copilot/drafts/55555555-5555-4555-8555-555555555555/confirm")
      .set(headers).set("Cookie", cookie).set("Idempotency-Key", "server-key").send({});
    expect(confirmed.status).toBe(200);
    expect(runtime.confirmAndExecute).toHaveBeenCalledOnce();
  });

  it("rejects tampered, wrong-branch, unprepared and client-price-bearing requests before persistence", async () => {
    const { app, runtime, state, cookie } = setup();
    const send = (body: object, branch = scope.branchId) => request(app).post("/copilot/conversation/drafts")
      .set(headers).set("X-Branch-Id", branch).set("Cookie", cookie).send(body);
    const token = writeBusinessState(state);
    expect((await send({ conversationToken: token + "forged", conversationId: state.conversationId })).status).toBe(400);
    expect((await send({ conversationToken: token, conversationId: state.conversationId, total: 1, productId: 99 })).status).toBe(400);
    expect((await send({ conversationToken: token, conversationId: state.conversationId }, "44444444-4444-4444-8444-444444444444")).status).toBe(400);
    delete state.draft!.preparedRevision;
    expect((await send({ conversationToken: writeBusinessState(state), conversationId: state.conversationId })).status).toBe(422);
    expect(runtime.createConversationDraft).not.toHaveBeenCalled();
  });

  it("does not allow an internal bearer token to substitute for the browser user", async () => {
    const { app, runtime, state } = setup();
    const result = await request(app).post("/copilot/conversation/drafts").set(headers)
      .set("Authorization", `Bearer ${env.INTERNAL_API_TOKEN}`).send({ conversationToken: writeBusinessState(state), conversationId: state.conversationId });
    expect(result.status).toBe(401);
    expect(runtime.createConversationDraft).not.toHaveBeenCalled();
  });

  it("returns refreshed authoritative rates for the approval screen when pricing changes before preparation", async () => {
    const { f, app, cookie, state } = setup();
    vi.mocked(f.services.pricing.resolvePrice).mockResolvedValue({ product_id: 26, unit_price: 500, unit: "MTR", rate_list_id: 4,
      rate_list_version_id: 10, rate_list_item_id: 26, currency_code: "PKR", minimum_quantity: 1, scope_type: "GLOBAL", effective_from: "2026-01-01" });
    const result = await request(app).post("/copilot/conversation/drafts").set(headers).set("Cookie", cookie)
      .send({ conversationToken: writeBusinessState(state), conversationId: state.conversationId });
    expect(result.status).toBe(201);
    expect(result.body.draft).toMatchObject({ lines: [{ rate: { unit_price: 500 } }], totals: { grand_total: 9000 } });
  });
});
