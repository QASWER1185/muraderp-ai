import { Router } from "express";
import { createSupabaseBrowserAuth, getBrowserAuthPrincipal } from "../auth/supabase-user-auth.js";

export function createBrowserAuthRouter(
  supabaseUrl?: string,
  supabasePublishableKey?: string,
  supabaseSecretKey?: string,
) {
  const router = Router();
  const authorize = createSupabaseBrowserAuth(supabaseUrl, supabaseSecretKey);

  router.get("/config", (_request, response) => {
    if (!supabaseUrl || !supabasePublishableKey) {
      response.status(503).json({
        error: {
          code: "AUTH_NOT_CONFIGURED",
          message: "Supabase browser authentication is not configured",
        },
      });
      return;
    }

    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ data: { supabaseUrl, supabasePublishableKey } });
  });

  router.get("/me", authorize, (request, response) => {
    const principal = getBrowserAuthPrincipal(request);
    response.setHeader("Cache-Control", "private, no-store");
    response.status(200).json({
      data: {
        userId: principal.user.id,
        email: principal.user.email ?? null,
        organizationId: principal.organizationId,
      },
    });
  });

  return router;
}
