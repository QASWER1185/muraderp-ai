import { Router } from "express";
import { browserSessionHandler } from "../auth/browser-session.js";
import { SupabaseWorkspaceDiscoveryService } from "../services/workspace-discovery.service.js";
export function createWorkspaceRouter(service = new SupabaseWorkspaceDiscoveryService(), authenticate = browserSessionHandler(true)) {
    const router = Router();
    router.get("/", authenticate, async (request, response) => {
        response.status(200).json({ data: await service.discover(request.browserPrincipal.userId) });
    });
    return router;
}
//# sourceMappingURL=workspace.routes.js.map