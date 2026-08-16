import express, { type RequestHandler } from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createBrowserCopilotRouter } from "../src/routes/ai-copilot.browser.routes.js";
import { createSupabaseBrowserAuth } from "../src/auth/supabase-user-auth.js";

const USER_ID = "00000000-0000-4000-8000-000000000002";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const ACTION_ID = "00000000-0000-4000-8000-000000000003";

const principalMiddleware: RequestHandler = (request, _response, next) => {
  request.browserAuth = {
    user: { id: USER_ID, app_metadata: { organization_id: ORGANIZATION_ID } } as any,
    organizationId: ORGANIZATION_ID,
  };
  next();
};

function appFor(runtime: any) {
  const app = express();
  app.use(express.json());
  app.use("/copilot", createBrowserCopilotRouter(runtime, principalMiddleware));
  return app;
}

describe("Authenticated browser Copilot contract", () => {
  it("creates a draft using the authenticated user and organization, not client identity headers", async () => {
    const runtime = {
      createDraft: vi.fn().mockResolvedValue({ id: ACTION_ID, status: "DRAFT" }),
      confirmAndExecute: vi.fn(),
    };

    const response = await request(appFor(runtime))
      .post("/copilot/drafts")
      .set("Authorization", "Bearer user-jwt-never-forwarded-as-internal-token")
      .set("Idempotency-Key", "browser-copilot-draft-1")
      .send({
        intent: "estimate",
        source: "text",
        customerId: "101",
        lines: [{ productName: "25mm Popular pipe", productId: 25, quantity: 50, unit: "pcs", unitRate: 120 }],
        confidence: 0.99,
      });

    expect(response.status).toBe(201);
    expect(response.body.requiresConfirmation).toBe(true);
    expect(runtime.createDraft).toHaveBeenCalledOnce();
    const [draft, context] = runtime.createDraft.mock.calls[0];
    expect(draft.organizationId).toBe(ORGANIZATION_ID);
    expect(context.userId).toBe(USER_ID);
    expect(draft.lines[0].productId.value).toBe(25);
    expect(draft.lines[0].unitRate.value).toBe(120);
    expect(JSON.stringify(response.body)).not.toContain("user-jwt-never-forwarded-as-internal-token");
  });

  it("confirms through the authoritative runtime using only the authenticated principal", async () => {
    const runtime = {
      createDraft: vi.fn(),
      confirmAndExecute: vi.fn().mockResolvedValue({ id: ACTION_ID, status: "EXECUTED" }),
    };

    const response = await request(appFor(runtime))
      .post(`/copilot/drafts/${ACTION_ID}/confirm`)
      .set("Authorization", "Bearer user-jwt")
      .set("Idempotency-Key", "browser-copilot-draft-1");

    expect(response.status).toBe(200);
    expect(response.body.executed).toBe(true);
    expect(runtime.confirmAndExecute).toHaveBeenCalledWith(ACTION_ID, ORGANIZATION_ID, USER_ID, "browser-copilot-draft-1");
  });

  it("requires an idempotency key before creating or confirming a transaction", async () => {
    const runtime = { createDraft: vi.fn(), confirmAndExecute: vi.fn() };
    const response = await request(appFor(runtime))
      .post("/copilot/drafts")
      .send({
        intent: "estimate",
        source: "text",
        customerId: "101",
        lines: [{ productName: "25mm Popular pipe", productId: 25, quantity: 50 }],
      });

    expect(response.status).toBe(400);
    expect(runtime.createDraft).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated browser requests before Copilot runtime access", async () => {
    const runtime = { createDraft: vi.fn(), confirmAndExecute: vi.fn() };
    const app = express();
    app.use(express.json());
    app.use(
      "/copilot",
      createBrowserCopilotRouter(
        runtime,
        createSupabaseBrowserAuth(undefined, undefined, async () => null),
      ),
    );

    const response = await request(app)
      .post("/copilot/drafts")
      .set("Idempotency-Key", "browser-copilot-unauthenticated")
      .send({
        intent: "estimate",
        source: "text",
        customerId: "101",
        lines: [{ productName: "25mm Popular pipe", productId: 25, quantity: 50 }],
      });

    expect(response.status).toBe(401);
    expect(runtime.createDraft).not.toHaveBeenCalled();
  });
});
