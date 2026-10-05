import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types.js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";

export type SearchScope = { userId: string; organizationId: string; branchId: string };
export type RankedEntity = { id: number; name: string; confidence: number; match_kind: string };
export type ProductCandidate = RankedEntity & { sku: string; unit: string; category: string; brandName: string | null };
export type CustomerCandidate = RankedEntity & { city: string };
export type EntityResolution<T extends RankedEntity> = {
  items: T[];
  resolution: "resolved" | "ambiguous" | "clarification" | "no_match";
  bestCandidate: T | null;
  requiresClarification: boolean;
  hasMore: boolean;
};

// Confidence is a deterministic matching score, not a statistical probability.
// Assess at least two rows before honoring a requested display limit of one.
export function resolveCandidates<T extends RankedEntity>(rows: T[], limit: number): EntityResolution<T> {
  const [first, second] = rows;
  const resolved = !!first && first.confidence >= 0.90 &&
    (!second || first.confidence - second.confidence >= 0.10 ||
      (first.match_kind === "exact_sku" && second.match_kind !== "exact_sku"));
  const resolution = !first ? "no_match" : resolved ? "resolved" :
    second && first.confidence - second.confidence < 0.10 ? "ambiguous" : "clarification";
  return { items: rows.slice(0, limit), resolution, bestCandidate: resolved ? first : null,
    requiresClarification: !resolved, hasMore: rows.length > limit };
}

export interface EntitySearchService {
  searchProducts(query: string, limit: number, scope: SearchScope): Promise<EntityResolution<ProductCandidate>>;
  searchCustomers(query: string, limit: number, scope: SearchScope): Promise<EntityResolution<CustomerCandidate>>;
  getProductBrand(brandId: number, organizationId: string): Promise<string | null>;
}

export class SupabaseEntitySearchService implements EntitySearchService {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient) {}

  private async search(name: "search_products_fuzzy" | "search_customers_fuzzy", query: string, limit: number, scope: SearchScope) {
    if (!scope.userId || !scope.organizationId || !scope.branchId) throw new ApiError(401,"TENANT_CONTEXT_REQUIRED","Authenticated tenant context required");
    if (!query.trim() || query.length > 120 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new ApiError(400,"INVALID_ENTITY_SEARCH","Invalid search query or result limit");
    const { data, error } = await this.clientFactory().rpc(name, {
      p_user_id: scope.userId, p_organization_id: scope.organizationId, p_branch_id: scope.branchId,
      p_query: query, p_limit: Math.max(2, limit),
    }) as unknown as { data: Array<Record<string, unknown>> | null; error: { code: string } | null };
    if (error) {
      if (error.code === "42501") throw new ApiError(403,"ENTITY_SEARCH_ACCESS_DENIED","Entity search access denied");
      throw new ApiError(503,"ENTITY_SEARCH_UNAVAILABLE","Database entity search is unavailable");
    }
    const rows = data ?? [];
    if (!Array.isArray(rows) || rows.length > 20 || rows.some((r) => !r || !Number.isSafeInteger(r.id) || Number(r.id) <= 0 ||
      typeof r.name !== "string" || typeof r.confidence !== "number" || !Number.isFinite(r.confidence) ||
      r.confidence < 0 || r.confidence > 1 || typeof r.match_kind !== "string" ||
      (name === "search_products_fuzzy" && (typeof r.sku !== "string" || typeof r.unit !== "string" || typeof r.category !== "string")) ||
      (r.brand_name != null && typeof r.brand_name !== "string") || (r.city != null && typeof r.city !== "string"))) {
      throw new ApiError(503,"ENTITY_SEARCH_INVALID_RESULT","Database search result could not be verified");
    }
    return rows;
  }

  async searchProducts(query: string, limit: number, scope: SearchScope) {
    const rows = await this.search("search_products_fuzzy",query,limit,scope);
    return resolveCandidates(rows.map((r): ProductCandidate => ({ id: Number(r.id), name: String(r.name),
      sku: String(r.sku), unit: String(r.unit), category: String(r.category),
      brandName: r.brand_name == null ? null : String(r.brand_name), confidence: Number(r.confidence), match_kind: String(r.match_kind) })),limit);
  }

  async searchCustomers(query: string, limit: number, scope: SearchScope) {
    const rows = await this.search("search_customers_fuzzy",query,limit,scope);
    return resolveCandidates(rows.map((r): CustomerCandidate => ({ id: Number(r.id), name: String(r.name),
      city: String(r.city ?? ""), confidence: Number(r.confidence), match_kind: String(r.match_kind) })),limit);
  }

  async getProductBrand(brandId: number, organizationId: string) {
    const { data, error } = await this.clientFactory().from("brands").select("name")
      .eq("id",brandId).eq("organization_id",organizationId).maybeSingle();
    if (error) throw new ApiError(503,"ENTITY_SEARCH_UNAVAILABLE","Product brand lookup unavailable");
    return data?.name ?? null;
  }
}
