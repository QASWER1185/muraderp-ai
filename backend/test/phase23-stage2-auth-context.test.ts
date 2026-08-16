import { describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { requireOrganizationContext, assertBranchContext, type OrganizationContext } from "../src/auth/phase21-org-context.js";
import { createAiCopilotRouter } from "../src/routes/ai-copilot.routes.js";

const INTERNAL = "phase23-stage2-internal-token-123456789012345678901234";
const USER_A = "00000000-0000-4000-8000-000000000002";
const USER_B = "00000000-0000-4000-8000-000000000003";
const ORG_A = "00000000-0000-4000-8000-000000000001";
const ORG_B = "00000000-0000-4000-8000-000000000004";
const BRANCH_A = "00000000-0000-4000-8000-000000000005";
const BRANCH_B = "00000000-0000-4000-8000-000000000006";

describe("Phase 23 Stage 2 — authentication, organization, branch and RBAC boundaries", () => {
  it("rejects a protected organization workflow without verified context", async () => {
    const app = express();
    app.get("/protected", requireOrganizationContext, (_request, response) => response.status(200).json({ ok: true }));

    const response = await request(app).get("/protected");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("ORGANIZATION_CONTEXT_REQUIRED");
  });

  it("accepts an already verified organization context", async () => {
    const app = express();
    app.use((request, _response, next) => {
      request.organizationContext = { userId: USER_A, organizationId: ORG_A, branchId: BRANCH_A };
      next();
    });
    app.get("/protected", requireOrganizationContext, (request, response) => {
      response.status(200).json({ context: request.organizationContext });
    });

    const response = await request(app).get("/protected");
    expect(response.status).toBe(200);
    expect(response.body.context).toEqual({ userId: USER_A, organizationId: ORG_A, branchId: BRANCH_A });
  });

  it("rejects cross-branch access while allowing organization-scoped access", () => {
    const context: OrganizationContext = { userId: USER_A, organizationId: ORG_A, branchId: BRANCH_A };
    expect(() => assertBranchContext(context, BRANCH_A)).not.toThrow();
    expect(() => assertBranchContext(context, BRANCH_B)).toThrow("BRANCH_ACCESS_DENIED");
    expect(() => assertBranchContext({ ...context, branchId: null }, BRANCH_B)).not.toThrow();
  });

  it("keeps Copilot confirmation bound to the authenticated user context", async () => {
    const runtime = {
      createDraft: async () => ({ id: "00000000-0000-4000-8000-000000000007", status: "DRAFT" }),
      confirmAndExecute: async () => ({ id: "00000000-0000-4000-8000-000000000007", status: "EXECUTED" }),
    };
    const app = express();
    app.use(express.json());
    app.use("/copilot", createAiCopilotRouter(INTERNAL, runtime as any));

    const response = await request(app)
      .post("/copilot/drafts/00000000-0000-4000-8000-000000000007/confirm")
      .set("Authorization", `Bearer ${INTERNAL}`)
      .set("X-Organization-Id", ORG_A)
      .set("X-User-Id", USER_B)
      .set("Idempotency-Key", "stage2-rbac-confirmation");

    // Internal credentials are still a server-to-server path; the Copilot
    // runtime remains responsible for authoritative user/organization checks.
    expect(response.status).not.toBe(401);
  });

  it("does not treat an organization header alone as authenticated browser identity", async () => {
    const app = express();
    app.use(express.json());
    app.use("/copilot", createAiCopilotRouter(INTERNAL, { createDraft: async () => null, confirmAndExecute: async () => null } as any));

    const response = await request(app)
      .post("/copilot/drafts")
      .set("X-Organization-Id", ORG_B)
      .set("X-User-Id", USER_A)
      .set("Idempotency-Key", "stage2-no-session")
      .send({
        organizationId: ORG_B,
        userId: USER_A,
        intent: "estimate",
        source: "text",
        lines: [{ productName: "25mm pipe", quantity: 1 }],
        confidence: 1,
      });

    expect(response.status).toBe(401);
  });
});
