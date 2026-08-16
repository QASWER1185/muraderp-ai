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

export type BrowserUserVerifier = (accessToken: string) => Promise<User | null>;

export function createSupabaseUserVerifier(supabaseUrl: string, supabaseSecretKey: string): BrowserUserVerifier {
  const client = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return async (accessToken) => {
    const { data, error } = await client.auth.getUser(accessToken);
    return error || !data.user ? null : data.user;
  };
}

export function createSupabaseBrowserAuth(
  supabaseUrl?: string,
  supabaseSecretKey?: string,
  verifyUser?: BrowserUserVerifier,
): RequestHandler {
  const verifier = verifyUser ?? (supabaseUrl && supabaseSecretKey
    ? createSupabaseUserVerifier(supabaseUrl, supabaseSecretKey)
    : null);

  return async (request, response, next) => {
    if (!verifier) {
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
      const user = await verifier(token);
      if (!user) {
        response.status(401).json({
          error: { code: "UNAUTHORIZED", message: "The authenticated user session is invalid or expired" },
        });
        return;
      }

      const organizationId = organizationIdFromUser(user);
      if (!organizationId) {
        response.status(403).json({
          error: {
            code: "ORGANIZATION_CONTEXT_REQUIRED",
            message: "The authenticated user has no organization_id in app_metadata",
          },
        });
        return;
      }

      request.browserAuth = { user, organizationId };
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
