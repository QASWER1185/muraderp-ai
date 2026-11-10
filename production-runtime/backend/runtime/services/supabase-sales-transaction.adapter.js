import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { normalizeServicePrincipalId } from "../security/service-principal.js";
import { SupabaseSalesTransactionRepository } from "../repositories/sales-transaction.repository.js";
/**
 * Compatibility adapter retained for existing callers/tests. P0-8 deliberately
 * delegates to the repository so there is only one backend RPC mapping for the
 * authoritative invoice posting boundary.
 */
export class SupabaseSalesTransactionAdapter {
    clientFactory;
    principalId;
    constructor(clientFactory = getSupabaseServiceRoleClient, principalId) {
        this.clientFactory = clientFactory;
        this.principalId = principalId;
    }
    async execute(request) {
        const principalId = normalizeServicePrincipalId(this.principalId);
        if (!principalId)
            throw new Error("Explicit sales transaction service principal is required");
        return new SupabaseSalesTransactionRepository(principalId, this.clientFactory).execute(request);
    }
}
//# sourceMappingURL=supabase-sales-transaction.adapter.js.map