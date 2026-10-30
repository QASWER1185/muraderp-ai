import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types.js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import { canonicalBrand, explicitBrand, sameBrand, matchesProductSpecification, canonicalCatalogQuery } from "../ai-copilot/productResolver.js";
import { canonicalSlipWords } from "../ai-copilot/shared/catalog-normalization.js";
import {customerPhoneticQuery} from '../ai-copilot/voice-choices.js';

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

/** Remove only common rate-question wording; keep catalog size and unit tokens intact. */
export function normalizeProductSearchQuery(query: string): string {
  return query.trim().replace(/[?؟.]+$/u, "")
    .replace(/^(?:what\s+(?:is\s+)?(?:the\s+)?(?:rate|price)\s+(?:of\s+)?|what\s+|(?:please\s+)?(?:show|tell|give)(?:\s+me)?\s+(?:the\s+)?(?:rate|price)\s+(?:of\s+)?)/iu,"")
    .replace(/\s+(?:کا|کی)\s+(?:ریٹ|قیمت)(?:\s+(?:بتاؤ|بتائیں|بتا دیں|کیا ہے))?$/u,"")
    .replace(/\s+(?:کمپنیوں|برانڈز)\s+کے\s+(?:ریٹ|قیمت)(?:\s+(?:بتاؤ|بتائیں|بتا دیں))?$/u,"")
    .replace(/\belboow\b/giu, "elbow")
    .replace(/\s+(?:(?:ka|ki)\s+)?(?:kia|kya)\s+rate\s+(?:hy|hai)$/iu, "")
    .replace(/\s+(?:(?:ka|ki)\s+)?rate\s+(?:(?:kia|kya)\s+)?(?:hy|hai)$/iu, "")
    .trim();
}

export interface EntitySearchService {
  searchProducts(query: string, limit: number, scope: SearchScope, brand?: string): Promise<EntityResolution<ProductCandidate>>;
  searchCustomers(query: string, limit: number, scope: SearchScope): Promise<EntityResolution<CustomerCandidate>>;
  getProductBrand(brandId: number, organizationId: string): Promise<string | null>;
}

export class SupabaseEntitySearchService implements EntitySearchService {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient) {}

  private async search(name: "search_products_fuzzy" | "search_customers_fuzzy", query: string, limit: number, scope: SearchScope, brand?: string) {
    if (!scope.userId || !scope.organizationId || !scope.branchId) throw new ApiError(401,"TENANT_CONTEXT_REQUIRED","Authenticated tenant context required");
    if (!query.trim() || query.length > 120 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new ApiError(400,"INVALID_ENTITY_SEARCH","Invalid search query or result limit");
    const searchQuery = name === "search_products_fuzzy" ? canonicalSlipWords(normalizeProductSearchQuery(query)) : query.replace(/\bbhai\b|بھائی/giu,"").replace(/\s+/g," ").trim();
    if (!searchQuery) throw new ApiError(400,"INVALID_ENTITY_SEARCH","Invalid search query or result limit");
    const { data, error } = await (this.clientFactory() as any).rpc(brand ? "search_catalog_products" : name, {
      p_user_id: scope.userId, p_organization_id: scope.organizationId, p_branch_id: scope.branchId,
      p_query: searchQuery, p_limit: Math.max(2, limit),
      ...(brand ? {p_brand:canonicalBrand(brand)} : {}),
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

  async searchProducts(query: string, limit: number, scope: SearchScope, brand?: string) {
    const restriction=brand ?? explicitBrand(query);
    let words=canonicalSlipWords(normalizeProductSearchQuery(query));
    // Spoken nominal PPR sizes differ from literal U-PVC / G.I. inch sizes.
    if(!/\bu-pvc\b|\bg\.?i\.?\b/i.test(words)&&/پونا\s*انچ|پون\s*انچ|ایک\s*انچ/u.test(query))words=words.replace(/3\/4 inch/g,"25mm").replace(/1 inch/g,"32mm");
    if(/\b(?:elbow|tee|socket|pipe)\b/i.test(words)&&!/(?:\bmm\b|inch|["″x×*/])/i.test(words))words=words.replace(/(?<![\w-])(16|20|25|32|40|50|63)\b(?!\s*°)/g,"$1mm");
    const catalogQuery=canonicalCatalogQuery(words,restriction);
    // Plain and threaded are semantic fitting variants; legacy catalog labels
    // often omit those words. Keep them for validation, not lexical retrieval.
    const lookupQuery=catalogQuery.replace(/\bplain\b/giu,"").replace(/\bthreaded\b/giu,"").replace(/\s+/g," ").trim();
    let rows = await this.search("search_products_fuzzy",lookupQuery,limit,scope,restriction);
    // Legacy products may name their brand without a brand FK. Search remains
    // tenant scoped; accept only an explicit matching name, never a fuzzy brand.
    const rowBrand=(row:Record<string,unknown>)=>row.brand_name==null?explicitBrand(String(row.name)):String(row.brand_name);
    if(restriction&&!rows.some(row=>sameBrand(rowBrand(row),restriction)&&matchesProductSpecification(catalogQuery.replace(/\bppr[\s-]*c\b/giu,''),String(row.name))))
      rows=await this.search("search_products_fuzzy",[restriction,lookupQuery.replace(/\b(?:u[\s-]*pvc|ppr[\s-]*c|inch|mm)\b/giu,'')].join(' ').replace(/\s+/g,' ').trim().slice(0,120),limit,scope);
    const headings=new Map<number,string>();
    const needsHeading=rows.filter(row=>(!restriction||sameBrand(row.brand_name as string|null,restriction))&&/\bppr[\s-]?c\b/i.test(catalogQuery)&&!/\bppr[\s-]?c\b/i.test(String(row.name)));
    if(needsHeading.length){
      const {data,error}=await (this.clientFactory() as any).from("rate_list_items")
        .select("product_id,rate_list_versions!inner(status,rate_lists!inner(name,organization_id,is_active,price_type))")
        .in("product_id",needsHeading.map(row=>row.id)).eq("rate_list_versions.status","ACTIVE")
        .eq("rate_list_versions.rate_lists.organization_id",scope.organizationId).eq("rate_list_versions.rate_lists.is_active",true).eq("rate_list_versions.rate_lists.price_type","SALE");
      if(error)throw new ApiError(503,"ENTITY_SEARCH_UNAVAILABLE","Catalog material lookup unavailable");
      for(const row of data??[]){const name=row.rate_list_versions?.rate_lists?.name;if(typeof name==="string")headings.set(Number(row.product_id),(headings.get(Number(row.product_id))??"")+" "+name);}
    }
    const eligible=rows.filter(r=>(!restriction || sameBrand(rowBrand(r),restriction)) && matchesProductSpecification(catalogQuery,String(r.name)+" "+String(r.sku)+" "+(headings.get(Number(r.id))??"")));
    const identity=(name:string)=>canonicalSlipWords(name).toLowerCase().replace(/\b(?:dura\s*(?:max|flow)|popular|turk\s*plast|he\s*china|ppr[\s-]?c|u[\s-]?pvc|plain|threaded)\b/gi,"").replace(/["″]/g,' inch').replace(/(\d)\s*(mm|inch)\b/g,'$1 $2').replace(/(\d)\s*x\s*(?=\d)/g,'$1 x ').match(/[\p{L}\p{N}]+/gu)?.sort().join(' ');
    // An exact family + complete dimensions beats a different family/angle,
    // while duplicate exact catalog records still require clarification.
    const exact=eligible.filter(row=>identity(String(row.name))===identity(catalogQuery));
    return resolveCandidates((exact.length?exact:eligible).map((r): ProductCandidate => ({ id: Number(r.id), name: String(r.name),
      sku: String(r.sku), unit: String(r.unit), category: String(r.category),
      brandName: rowBrand(r)??null, confidence: exact.length?1:Number(r.confidence), match_kind: exact.length===1?'exact_name':String(r.match_kind) })),limit);
  }

  async searchCustomers(query: string, limit: number, scope: SearchScope) {
    const normalized=customerPhoneticQuery(query);
    const rows = await this.search("search_customers_fuzzy",normalized,limit,scope);
    const identity=(name:string)=>name.toLowerCase().replace(/\b(?:sb|sahib|bhai)\b|صاحب|بھائی/giu,'').replace(/\s+/g,' ').trim();
    return resolveCandidates(rows.map((r): CustomerCandidate => ({ id: Number(r.id), name: String(r.name),
      city: String(r.city ?? ""), confidence:identity(String(r.name))===identity(normalized)?1:Number(r.confidence), match_kind:identity(String(r.name))===identity(normalized)?'exact_name':String(r.match_kind) })).sort((a,b)=>b.confidence-a.confidence),limit);
  }

  async getProductBrand(brandId: number, organizationId: string) {
    const { data, error } = await this.clientFactory().from("brands").select("name")
      .eq("id",brandId).eq("organization_id",organizationId).maybeSingle();
    if (error) throw new ApiError(503,"ENTITY_SEARCH_UNAVAILABLE","Product brand lookup unavailable");
    return data?.name ?? null;
  }
}
