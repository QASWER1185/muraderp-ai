import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types.js";
import type { InvoiceTransactionResult } from "../types/invoice.types.js";
import type { SalesTransactionPort, SalesTransactionRequest } from "../types/sales-transaction.types.js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { normalizeServicePrincipalId } from "../security/service-principal.js";
import { SupabaseSalesTransactionRepository } from "../repositories/sales-transaction.repository.js";

/**
 * Compatibility adapter retained for existing callers/tests. P0-8 deliberately
 * delegates to the repository so there is only one backend RPC mapping for the
 * authoritative invoice posting boundary.
 */
export class SupabaseSalesTransactionAdapter implements SalesTransactionPort {
  constructor(clientFactory: () => SupabaseClient<Database>, principalId: string);
  constructor(
    private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient,
    private readonly principalId?: string,
  ) {}

  async execute(request: SalesTransactionRequest): Promise<InvoiceTransactionResult> {
    const principalId = normalizeServicePrincipalId(this.principalId);
    if (!principalId) throw new Error("Explicit sales transaction service principal is required");
    return new SupabaseSalesTransactionRepository(principalId, this.clientFactory).execute(request);
  }
}
