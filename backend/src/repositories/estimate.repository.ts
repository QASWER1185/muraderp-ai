import { getSupabaseAdminClient } from "../config/supabase.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstimateDefinition, EstimateStatus } from "../types/estimate-document.types.js";
import type { PricedEstimateLine } from "../types/estimate.types.js";

type EstimateDatabaseClient = SupabaseClient & {
  from(table: "estimates" | "estimate_items"): any;
};

export interface EstimateRecord extends EstimateDefinition {
  id: number;
  status: EstimateStatus;
  source_type: "MANUAL" | "OCR" | "VOICE" | "IMPORT" | "AI_ASSISTED";
  source_reference: string | null;
  created_at: string;
  updated_at: string;
}

export interface EstimateItemRecord {
  id: number;
  estimate_id: number;
  line_number: number;
  product_id: number;
  description: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_amount: number;
  pricing_source: "RESOLVED_RATE" | "MANUAL_OVERRIDE";
  rate_list_id: number | null;
  rate_list_version_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEstimateInput {
  definition: EstimateDefinition;
  source_type?: EstimateRecord["source_type"];
  source_reference?: string | null;
  lines: PricedEstimateLine[];
}

export interface EstimateRepository {
  createEstimate(input: CreateEstimateInput): Promise<EstimateRecord>;
  createEstimateItem(estimateId: number, line: PricedEstimateLine): Promise<EstimateItemRecord>;
}

export class SupabaseEstimateRepository implements EstimateRepository {
  constructor(
    private readonly clientFactory: () => SupabaseClient = getSupabaseAdminClient,
  ) {}

  async createEstimate(input: CreateEstimateInput): Promise<EstimateRecord> {
    const client = this.clientFactory() as EstimateDatabaseClient;
    const { data, error } = await client
      .from("estimates")
      .insert({
        customer_id: input.definition.customer_id,
        estimate_number: input.definition.estimate_number,
        issue_date: input.definition.issue_date,
        currency_code: input.definition.currency_code,
        status: "DRAFT",
        notes: input.definition.notes ?? null,
        source_type: input.source_type ?? "MANUAL",
        source_reference: input.source_reference ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data as EstimateRecord;
  }

  async createEstimateItem(estimateId: number, line: PricedEstimateLine): Promise<EstimateItemRecord> {
    const client = this.clientFactory() as EstimateDatabaseClient;
    const resolved = line.resolved_price;
    const { data, error } = await client
      .from("estimate_items")
      .insert({
        estimate_id: estimateId,
        line_number: line.line_number,
        product_id: line.product_id,
        description: null,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unit_price,
        discount_amount: 0,
        pricing_source: line.pricing_source,
        rate_list_id: resolved?.rate_list_id ?? null,
        rate_list_version_id: resolved?.rate_list_version_id ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data as EstimateItemRecord;
  }
}
