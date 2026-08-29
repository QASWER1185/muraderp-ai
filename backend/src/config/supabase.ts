import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types.js";
import { ApiError } from "../errors/api-error.js";
import { env } from "./env.js";

declare const serviceRoleClientBrand: unique symbol;
export type ServiceRoleSupabaseClient = SupabaseClient<Database> & {
  readonly [serviceRoleClientBrand]: true;
};

let serviceRoleClient: ServiceRoleSupabaseClient | undefined;

export function getSupabaseServiceRoleClient(): ServiceRoleSupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new ApiError(503, "ERP_NOT_CONFIGURED", "Database-backed ERP routes are not configured");
  }

  serviceRoleClient ??= createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as ServiceRoleSupabaseClient;

  return serviceRoleClient;
}

/** @deprecated Use getSupabaseServiceRoleClient to make the privileged boundary explicit. */
export const getSupabaseAdminClient = getSupabaseServiceRoleClient;
