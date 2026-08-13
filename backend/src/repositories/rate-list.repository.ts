import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import type { Database } from "../types/database.types.js";
import type {
  RateListDefinition,
  RateListItemDefinition,
  RateListVersionDefinition,
} from "../types/pricing.types.js";

type PricingDatabaseClient = SupabaseClient<Database> & {
  from(table: "rate_lists" | "rate_list_versions" | "rate_list_items"): any;
};

export interface RateListRecord extends RateListDefinition {
  id: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RateListVersionRecord extends RateListVersionDefinition {
  id: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  created_at: string;
  updated_at: string;
}

export interface RateListItemRecord extends RateListItemDefinition {
  id: number;
  minimum_quantity: number;
  created_at: string;
  updated_at: string;
}

/** Repository contract for rate-list authoring and picker operations. */
export interface RateListRepository {
  createRateList(input: RateListDefinition): Promise<RateListRecord>;
  createVersion(input: RateListVersionDefinition): Promise<RateListVersionRecord>;
  createItem(input: RateListItemDefinition): Promise<RateListItemRecord>;
  listActiveSaleRateLists(): Promise<RateListRecord[]>;
}

/** Separate lifecycle boundary for publication/archive operations. */
export interface RateListLifecycleRepository {
  getVersion(versionId: number): Promise<RateListVersionRecord>;
  activateVersion(versionId: number): Promise<RateListVersionRecord>;
  archiveVersion(versionId: number): Promise<RateListVersionRecord>;
}

export class SupabaseRateListRepository implements RateListRepository, RateListLifecycleRepository {
  constructor(
    private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseAdminClient,
  ) {}

  async createRateList(input: RateListDefinition): Promise<RateListRecord> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_lists").insert({
      name: input.name,
      code: input.code,
      price_type: input.price_type,
      scope_type: input.scope_type,
      vendor_id: input.vendor_id ?? null,
      customer_id: input.customer_id ?? null,
      currency_code: input.currency_code,
      is_active: input.is_active ?? true,
    }).select().single();
    if (error) throw error;
    return data as RateListRecord;
  }

  async createVersion(input: RateListVersionDefinition): Promise<RateListVersionRecord> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_list_versions").insert({
      rate_list_id: input.rate_list_id,
      version_number: input.version_number,
      status: input.status ?? "DRAFT",
      effective_from: input.effective_from,
      effective_to: input.effective_to ?? null,
    }).select().single();
    if (error) throw error;
    return data as RateListVersionRecord;
  }

  async createItem(input: RateListItemDefinition): Promise<RateListItemRecord> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_list_items").insert({
      rate_list_version_id: input.rate_list_version_id,
      product_id: input.product_id,
      minimum_quantity: input.minimum_quantity ?? 1,
      unit_price: input.unit_price,
      unit: input.unit,
    }).select().single();
    if (error) throw error;
    return data as RateListItemRecord;
  }

  async listActiveSaleRateLists(): Promise<RateListRecord[]> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_lists")
      .select("id, name, code, price_type, scope_type, vendor_id, customer_id, currency_code, is_active, created_at, updated_at")
      .eq("price_type", "SALE")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as RateListRecord[];
  }

  async getVersion(versionId: number): Promise<RateListVersionRecord> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_list_versions")
      .select("id, rate_list_id, version_number, status, effective_from, effective_to, created_at, updated_at")
      .eq("id", versionId)
      .single();
    if (error) throw error;
    return data as RateListVersionRecord;
  }

  async activateVersion(versionId: number): Promise<RateListVersionRecord> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_list_versions")
      .update({ status: "ACTIVE", updated_at: new Date().toISOString() })
      .eq("id", versionId)
      .eq("status", "DRAFT")
      .select("id, rate_list_id, version_number, status, effective_from, effective_to, created_at, updated_at")
      .single();
    if (error) throw error;
    return data as RateListVersionRecord;
  }

  async archiveVersion(versionId: number): Promise<RateListVersionRecord> {
    const client = this.clientFactory() as PricingDatabaseClient;
    const { data, error } = await client.from("rate_list_versions")
      .update({ status: "ARCHIVED", updated_at: new Date().toISOString() })
      .eq("id", versionId)
      .eq("status", "ACTIVE")
      .select("id, rate_list_id, version_number, status, effective_from, effective_to, created_at, updated_at")
      .single();
    if (error) throw error;
    return data as RateListVersionRecord;
  }
}
