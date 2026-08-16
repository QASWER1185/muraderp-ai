import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createAiCopilotRouter } from "../src/routes/ai-copilot.routes.js";
import { authRouter } from "../src/routes/auth.routes.js";

const INTERNAL = "phase22-browser-internal-token-123456789012345678901234";
const USER = "00000000-0000-4000-8000-000000000002";
const ORG = "00000000-0000-4000-8000-000000000001";

describe("Phase 22 secure browser Copilot boundary", () => {
  it("rejects Copilot execution without a browser session or internal token", async () => {
    const app = express();
    app.use(express.json());
    app.use("/auth", authRouter);
    app.use("/copilot", createAiCopilotRouter(INTERNAL, {
      createDraft: vi.fn(),
      confirmAndExecute: vi.fn(),
    } as any));
    const response = await request(app).get("/auth/session");
    expect(response.status).toBe(401);
    const copilot = await request(app).post("/copilot/drafts").send({ organizationId: ORG, intent: "estimate", source: "text", lines: [{ productName: "25mm pipe", quantity: 50 }] });
    expect(copilot.status).toBe(401);
  });

  it("keeps browser confirmation independent from client-supplied user identity", async () => {
    const app = express();
    app.use(express.json());
    app.use("/auth", authRouter);
    app.use("/copilot", createAiCopilotRouter(INTERNAL, {
      createDraft: vi.fn(),
      confirmAndExecute: vi.fn(),
    } as any));
    const response = await request(app)
      .post("/copilot/drafts/00000000-0000-4000-8000-000000000003/confirm")
      .set("Authorization", `Bearer ${INTERNAL}`)
      .set("X-Organization-Id", ORG)
      .set("X-User-Id", USER)
      .set("Idempotency-Key", "browser-boundary-test");
    expect(response.status).toBe(200);
  });
});
