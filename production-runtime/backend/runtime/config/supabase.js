import { createClient } from "@supabase/supabase-js";
import { ApiError } from "../errors/api-error.js";
import { env } from "./env.js";
let serviceRoleClient;
export function getSupabaseServiceRoleClient() {
    if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
        throw new ApiError(503, "ERP_NOT_CONFIGURED", "Database-backed ERP routes are not configured");
    }
    serviceRoleClient ??= createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
    });
    return serviceRoleClient;
}
/** @deprecated Use getSupabaseServiceRoleClient to make the privileged boundary explicit. */
export const getSupabaseAdminClient = getSupabaseServiceRoleClient;
//# sourceMappingURL=supabase.js.map