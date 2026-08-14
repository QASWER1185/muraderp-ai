import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import type { Database } from "../types/database.types.js";
import type { PriceResolutionContext, RateListDefinition, RateListItemDefinition, RateListVersionDefinition, ResolvedPrice } from "../types/pricing.types.js";

type PricingDatabaseClient = SupabaseClient<Database> & { from(table: "rate_lists" | "rate_list_versions" | "rate_list_items"): any };

export interface RateListRecord extends RateListDefinition { id: number; is_active: boolean; created_at: string; updated_at: string; }
export interface RateListVersionRecord extends RateListVersionDefinition { id: number; status: "DRAFT" | "ACTIVE" | "ARCHIVED"; created_at: string; updated_at: string; }
export interface RateListItemRecord extends RateListItemDefinition { id: number; minimum_quantity: number; created_at: string; updated_at: string; }

export interface RateListRepository {
  createRateList(input: RateListDefinition): Promise<RateListRecord>;
  createVersion(input: RateListVersionDefinition): Promise<RateListVersionRecord>;
  createItem(input: RateListItemDefinition): Promise<RateListItemRecord>;
  listActiveSaleRateLists(): Promise<RateListRecord[]>;
  findBestRateListItem(context: PriceResolutionContext): Promise<ResolvedPrice | null>;
}

export interface RateListLifecycleRepository {
  getVersion(versionId: number): Promise<RateListVersionRecord>;
  activateVersion(versionId: number): Promise<RateListVersionRecord>;
  archiveVersion(versionId: number): Promise<RateListVersionRecord>;
}

const scopePriority: Record<RateListRecord["scope_type"], number> = { CUSTOMER: 3, VENDOR: 2, GLOBAL: 1 };

export class SupabaseRateListRepository implements RateListRepository, RateListLifecycleRepository {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseAdminClient) {}

  async createRateList(input: RateListDefinition): Promise<RateListRecord> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_lists").insert({ name: input.name, code: input.code, price_type: input.price_type, scope_type: input.scope_type, vendor_id: input.vendor_id ?? null, customer_id: input.customer_id ?? null, currency_code: input.currency_code, is_active: input.is_active ?? true }).select().single();
    if (error) throw error;
    return data as RateListRecord;
  }

  async createVersion(input: RateListVersionDefinition): Promise<RateListVersionRecord> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_list_versions").insert({ rate_list_id: input.rate_list_id, version_number: input.version_number, status: input.status ?? "DRAFT", effective_from: input.effective_from, effective_to: input.effective_to ?? null }).select().single();
    if (error) throw error;
    return data as RateListVersionRecord;
  }

  async createItem(input: RateListItemDefinition): Promise<RateListItemRecord> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_list_items").insert({ rate_list_version_id: input.rate_list_version_id, product_id: input.product_id, minimum_quantity: input.minimum_quantity ?? 1, unit_price: input.unit_price, unit: input.unit }).select().single();
    if (error) throw error;
    return data as RateListItemRecord;
  }

  async listActiveSaleRateLists(): Promise<RateListRecord[]> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_lists").select("id, name, code, price_type, scope_type, vendor_id, customer_id, currency_code, is_active, created_at, updated_at").eq("price_type", "SALE").eq("is_active", true).order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as RateListRecord[];
  }

  async findBestRateListItem(context: PriceResolutionContext): Promise<ResolvedPrice | null> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const asOf = Date.parse(context.as_of);
    let rateListQuery = client.from("rate_lists").select("id, name, code, price_type, scope_type, vendor_id, customer_id, currency_code, is_active, created_at, updated_at").eq("price_type", context.price_type).eq("is_active", true);
    if (context.rate_list_id != null) rateListQuery = rateListQuery.eq("id", context.rate_list_id);
    const { data: rateLists, error: rateListError } = await rateListQuery;
    if (rateListError) throw rateListError;

    const applicableRateLists = ((rateLists ?? []) as RateListRecord[]).filter((rateList) => {
      if (context.rate_list_id != null) return rateList.id === context.rate_list_id;
      if (rateList.scope_type === "CUSTOMER") return rateList.customer_id === context.customer_id;
      if (rateList.scope_type === "VENDOR") return rateList.vendor_id === context.vendor_id;
      return rateList.scope_type === "GLOBAL";
    });
    if (applicableRateLists.length === 0) return null;

    const { data: versions, error: versionError } = await client.from("rate_list_versions").select("id, rate_list_id, version_number, status, effective_from, effective_to, created_at, updated_at").in("rate_list_id", applicableRateLists.map((r) => r.id)).eq("status", "ACTIVE");
    if (versionError) throw versionError;
    const applicableVersions = (versions ?? []).filter((version: RateListVersionRecord) => {
      const from = Date.parse(version.effective_from);
      const to = version.effective_to ? Date.parse(version.effective_to) : Number.POSITIVE_INFINITY;
      return from <= asOf && asOf < to;
    });
    if (applicableVersions.length === 0) return null;

    const { data: items, error: itemError } = await client.from("rate_list_items").select("id, rate_list_version_id, product_id, minimum_quantity, unit_price, unit, created_at, updated_at").in("rate_list_version_id", applicableVersions.map((v) => v.id)).eq("product_id", context.product_id).lte("minimum_quantity", context.quantity);
    if (itemError) throw itemError;

    const candidates = (items ?? []).map((item: RateListItemRecord) => {
      const version = applicableVersions.find((v) => v.id === item.rate_list_version_id)!;
      const rateList = applicableRateLists.find((r) => r.id === version.rate_list_id)!;
      return { item, version, rateList };
    });
    candidates.sort((a, b) => {
      const scope = scopePriority[b.rateList.scope_type] - scopePriority[a.rateList.scope_type];
      if (scope !== 0) return scope;
      const quantity = b.item.minimum_quantity - a.item.minimum_quantity;
      if (quantity !== 0) return quantity;
      const effective = Date.parse(b.version.effective_from) - Date.parse(a.version.effective_from);
      if (effective !== 0) return effective;
      return b.version.version_number - a.version.version_number;
    });
    const best = candidates[0];
    if (!best) return null;
    return { rate_list_id: best.rateList.id, rate_list_version_id: best.version.id, rate_list_item_id: best.item.id, product_id: best.item.product_id, unit_price: best.item.unit_price, unit: best.item.unit, currency_code: best.rateList.currency_code, minimum_quantity: best.item.minimum_quantity, scope_type: best.rateList.scope_type, effective_from: best.version.effective_from };
  }

  async getVersion(versionId: number): Promise<RateListVersionRecord> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_list_versions").select("id, rate_list_id, version_number, status, effective_from, effective_to, created_at, updated_at").eq("id", versionId).single();
    if (error) throw error;
    return data as RateListVersionRecord;
  }

  async activateVersion(versionId: number): Promise<RateListVersionRecord> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_list_versions").update({ status: "ACTIVE", updated_at: new Date().toISOString() }).eq("id", versionId).eq("status", "DRAFT").select("id, rate_list_id, version_number, status, effective_from, effective_to, created_at, updated_at").single();
    if (error) throw error;
    return data as RateListVersionRecord;
  }

  async archiveVersion(versionId: number): Promise<RateListVersionRecord> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_list_versions").update({ status: "ARCHIVED", updated_at: new Date().toISOString() }).eq("id", versionId).eq("status", "ACTIVE").select("id, rate_list_id, version_number, status, effective_from, effective_to, created_at, updated_at").single();
    if (error) throw error;
    return data as RateListVersionRecord;
  }
}
