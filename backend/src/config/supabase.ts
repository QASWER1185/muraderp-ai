import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types.js";
import { ApiError } from "../errors/api-error.js";
import { env } from "./env.js";

let adminClient: SupabaseClient<Database> | undefined;

export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new ApiError(
      503,
      "ERP_NOT_CONFIGURED",
      "Database-backed ERP routes are not configured",
    );
  }

  adminClient ??= createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return adminClient;
}
