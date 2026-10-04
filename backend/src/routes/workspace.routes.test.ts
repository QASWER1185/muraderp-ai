import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceRouter } from "./workspace.routes.js";
import { assembleAuthorizedWorkspaces } from "../services/workspace-discovery.service.js";

const userId = "ec309eef-0405-4b83-9836-1e757b30abf5";
const organizationId = "60460719-45f4-4d9b-9fa1-3d81d35ed302";
const branchId = "c57e64ed-da40-40f6-b038-a55e869184b9";
const otherId = "11111111-1111-4111-8111-111111111111";

describe("authenticated workspace discovery", () => {
  it("derives the user from the browser principal instead of a caller header", async () => {
    const discover = vi.fn().mockResolvedValue([{ organizationId, organizationName: "M MURAD BUILDING MATERIALS STORE", branches: [{ branchId, branchName: "Main Branch" }] }]);
    const app = express();
    app.use("/api/v1/workspaces", createWorkspaceRouter({ discover }, (req, _res, next) => { req.browserPrincipal = { userId }; next(); }));
    const response = await request(app).get("/api/v1/workspaces").set("X-Actor-User-Id", otherId);
    expect(response.status).toBe(200);
    expect(discover).toHaveBeenCalledWith(userId);
    expect(response.body.data[0].branches[0].branchId).toBe(branchId);
  });

  it("rejects unauthenticated discovery", async () => {
    const discover = vi.fn();
    const app = express();
    app.use("/api/v1/workspaces", createWorkspaceRouter({ discover }));
    const response = await request(app).get("/api/v1/workspaces");
    expect(response.status).toBe(401);
    expect(discover).not.toHaveBeenCalled();
  });

  it("returns only active memberships, grants, and matching active branches", () => {
    const workspaces = assembleAuthorizedWorkspaces(userId,
      [
        { user_id: userId, organization_id: organizationId, status: "active" },
        { user_id: userId, organization_id: otherId, status: "suspended" },
      ],
      [{ id: organizationId, name: "M MURAD BUILDING MATERIALS STORE" }, { id: otherId, name: "Other" }],
      [
        { user_id: userId, organization_id: organizationId, branch_id: branchId, status: "active" },
        { user_id: userId, organization_id: organizationId, branch_id: otherId, status: "revoked" },
        { user_id: otherId, organization_id: organizationId, branch_id: otherId, status: "active" },
      ],
      [
        { id: branchId, organization_id: organizationId, name: "Main Branch", status: "active" },
        { id: otherId, organization_id: organizationId, name: "Other Branch", status: "active" },
      ]);
    expect(workspaces).toEqual([{ organizationId, organizationName: "M MURAD BUILDING MATERIALS STORE", branches: [{ branchId, branchName: "Main Branch" }] }]);
  });
});
