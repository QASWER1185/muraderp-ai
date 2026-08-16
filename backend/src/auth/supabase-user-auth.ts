import { createClient, type User } from "@supabase/supabase-js";
import type { RequestHandler } from "express";

export interface BrowserAuthPrincipal {
  user: User;
  organizationId: string;
}

declare global {
  namespace Express {
    interface Request {
      browserAuth?: BrowserAuthPrincipal;
    }
  }
}

function bearerToken(request: { header(name: string): string | undefined }): string | undefined {
  const authorization = request.header("authorization");
  const [scheme, token] = authorization?.split(" ", 2) ?? [];
  return scheme === "Bearer" && token ? token : undefined;
}

function organizationIdFromUser(user: User): string | undefined {
  const metadata = user.app_metadata as Record<string, unknown> | undefined;
  const value = metadata?.organization_id ?? metadata?.organizationId;
  return typeof value === "string" ? value : undefined;
}

export function createSupabaseBrowserAuth(
  supabaseUrl?: string,
  supabaseSecretKey?: string,
): RequestHandler {
  const client = supabaseUrl && supabaseSecretKey
    ? createClient(supabaseUrl, supabaseSecretKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      })
    : null;

  return async (request, response, next) => {
    if (!client) {
      response.status(503).json({
        error: {
          code: "AUTH_NOT_CONFIGURED",
          message: "Supabase authentication is not configured",
        },
      });
      return;
    }

    const token = bearerToken(request);
    if (!token) {
      response.status(401).json({
        error: { code: "UNAUTHORIZED", message: "A valid authenticated user session is required" },
      });
      return;
    }

    try {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) {
        response.status(401).json({
          error: { code: "UNAUTHORIZED", message: "The authenticated user session is invalid or expired" },
        });
        return;
      }

      const organizationId = organizationIdFromUser(data.user);
      if (!organizationId) {
        response.status(403).json({
          error: {
            code: "ORGANIZATION_CONTEXT_REQUIRED",
            message: "The authenticated user has no organization_id in app_metadata",
          },
        });
        return;
      }

      request.browserAuth = { user: data.user, organizationId };
      next();
    } catch {
      response.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Unable to validate the authenticated user session" },
      });
    }
  };
}

export function getBrowserAuthPrincipal(request: Express.Request): BrowserAuthPrincipal {
  if (!request.browserAuth) throw new Error("Authenticated browser principal is missing");
  return request.browserAuth;
}
