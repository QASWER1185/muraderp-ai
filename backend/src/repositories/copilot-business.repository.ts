import { z } from "zod";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { AgentScope } from "../ai-copilot/agent/erp-tools.js";
import { resolveCandidates, type EntityResolution, type RankedEntity } from "../services/entity-search.service.js";

const number = z.number().finite();
const identifier = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ledgerSchema = z.object({
  balances: z.array(z.object({ currency_code: z.string(), debit: number, credit: number, outstanding: number })),
  transactions: z.array(z.object({ id: identifier, date: z.string(), entryType: z.string(), referenceType: z.string(), referenceId: identifier,
    debit: number, credit: number, currencyCode: z.string(), description: z.string().nullable(),
    journals: z.array(z.object({ id: z.string().uuid(), date: z.string(), sourceType: z.string(), status: z.literal("POSTED") })) })).max(20),
  nextCursor: identifier.nullable(),
  latestPayment: z.object({ id: identifier, date: z.string(), amount: number, currencyCode: z.string(), referenceId: identifier }).nullable(),
});
export type CustomerLedger = z.infer<typeof ledgerSchema>;
export interface CopilotBusinessRepository {
  customerLedger(scope: AgentScope, customerId: number, limit: number, beforeId?: number): Promise<CustomerLedger>;
  searchVendors(scope: AgentScope, query: string, limit: number): Promise<EntityResolution<RankedEntity>>;
}
type Client = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }> };
export class SupabaseCopilotBusinessRepository implements CopilotBusinessRepository {
  constructor(private readonly clientFactory: () => Client = () => getSupabaseServiceRoleClient() as unknown as Client) {}
  private async read(name: string, scope: AgentScope, args: Record<string, unknown>) {
    const { data, error } = await this.clientFactory().rpc(name, { p_user_id: scope.userId, p_organization_id: scope.organizationId, p_branch_id: scope.branchId, ...args });
    if (error?.code === "42501") throw new ApiError(403, "BUSINESS_READ_FORBIDDEN", "Business data access is not authorized.");
    if (error) throw new ApiError(502, "BUSINESS_READ_UNAVAILABLE", "Authoritative business data could not be loaded.");
    return data;
  }
  async customerLedger(scope: AgentScope, customerId: number, limit: number, beforeId?: number) {
    return ledgerSchema.parse(await this.read("copilot_customer_ledger", scope, { p_customer_id: customerId, p_limit: limit, p_before_id: beforeId ?? null }));
  }
  async searchVendors(scope: AgentScope, query: string, limit: number) {
    const rows = await this.read("search_vendors_fuzzy", scope, { p_query: query, p_limit: limit });
    return resolveCandidates(z.array(z.object({ id: identifier, name: z.string(), confidence: number, match_kind: z.string() })).max(20).parse(rows), limit);
  }
}
