import { Router, type RequestHandler } from "express";
import { browserSessionHandler } from "../auth/browser-session.js";
import { SupabaseWorkspaceDiscoveryService, type WorkspaceDiscoveryService } from "../services/workspace-discovery.service.js";

export function createWorkspaceRouter(service: WorkspaceDiscoveryService = new SupabaseWorkspaceDiscoveryService(), authenticate: RequestHandler = browserSessionHandler(true)): Router {
  const router = Router();
  router.get("/", authenticate, async (request, response) => {
    response.status(200).json({ data: await service.discover(request.browserPrincipal!.userId) });
  });
  return router;
}
