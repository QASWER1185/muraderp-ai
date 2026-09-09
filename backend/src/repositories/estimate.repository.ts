import { getSupabaseAdminClient } from "../config/supabase.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstimateDefinition, EstimateStatus } from "../types/estimate-document.types.js";
import type { PricedEstimateLine } from "../types/estimate.types.js";
import { ApiError } from "../errors/api-error.js";

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
  rate_list_selection_source?: "INHERITED" | "LINE_OVERRIDE" | "AI_SUGGESTED" | "MANUAL";
  brand_hint?: string | null;
  manual_unit_price?: number | null;
  line_amount?: number;
  pricing_provenance?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEstimateInput {
  definition: EstimateDefinition;
  source_type?: EstimateRecord["source_type"];
  source_reference?: string | null;
  lines: PricedEstimateLine[];
  branch_id?: string | null;
  actor_user_id?: string | null;
  idempotency_key?: string | null;
  conversion_request?: Record<string, unknown>;
  source_fingerprint?: string;
}

export interface CreateEstimateAtomicResult {
  record: EstimateRecord;
  items: EstimateItemRecord[];
}

export interface EstimateRepository {
  createEstimate(input: CreateEstimateInput): Promise<EstimateRecord>;
  createEstimateItem(estimateId: number, line: PricedEstimateLine): Promise<EstimateItemRecord>;
  /** All estimate creation uses one database transaction for the header and lines. */
  createEstimateAtomic(input: CreateEstimateInput): Promise<CreateEstimateAtomicResult>;
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
        organization_id: input.definition.organization_id,
        branch_id: input.branch_id ?? input.definition.branch_id ?? null,
        customer_id: input.definition.customer_id,
        estimate_number: input.definition.estimate_number,
        issue_date: input.definition.issue_date,
        currency_code: input.definition.currency_code,
        status: "DRAFT",
        notes: input.definition.notes ?? null,
        source_type: input.source_type ?? "MANUAL",
        source_reference: input.source_reference ?? null,
        pass_through_rent: input.definition.pass_through_rent ?? 0,
        pass_through_rent_payee: input.definition.pass_through_rent_payee ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data as EstimateRecord;
  }

  async createEstimateItem(estimateId: number, line: PricedEstimateLine): Promise<EstimateItemRecord> {
    const client = this.clientFactory() as EstimateDatabaseClient;
    const resolved = line.resolved_price;
    const dbSelectionSource = line.rate_list_selection_source === "ESTIMATE_DEFAULT"
      ? "INHERITED"
      : line.rate_list_selection_source === "OCR_BRAND_MATCH" || line.rate_list_selection_source === "VOICE_BRAND_MATCH"
        ? "AI_SUGGESTED"
        : line.rate_list_selection_source === "MANUAL_OVERRIDE"
          ? "MANUAL"
          : line.rate_list_selection_source ?? "INHERITED";
    const discountAmount = line.discount_amount ?? 0;
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
        discount_amount: discountAmount,
        pricing_source: line.pricing_source,
        rate_list_id: resolved?.rate_list_id ?? line.rate_list_id ?? null,
        rate_list_version_id: resolved?.rate_list_version_id ?? line.rate_list_version_id ?? null,
        rate_list_selection_source: dbSelectionSource,
        brand_hint: line.brand_hint ?? null,
        manual_unit_price: line.pricing_source === "MANUAL_OVERRIDE" ? line.unit_price : null,
        line_amount: line.quantity * line.unit_price - discountAmount,
        pricing_provenance: {
          product_id: line.product_id,
          rate_list_id: resolved?.rate_list_id ?? line.rate_list_id ?? null,
          rate_list_version_id: resolved?.rate_list_version_id ?? line.rate_list_version_id ?? null,
          selection_source: dbSelectionSource,
          brand_hint: line.brand_hint ?? null,
          pricing_source: line.pricing_source,
          manual_unit_price: line.pricing_source === "MANUAL_OVERRIDE" ? line.unit_price : null,
          quantity: line.quantity,
          unit: line.unit,
          discount_amount: discountAmount,
          line_amount: line.quantity * line.unit_price - discountAmount,
          resolved_price: line.resolved_price ?? null,
        },
      })
      .select()
      .single();

    if (error) throw error;
    return data as EstimateItemRecord;
  }

  async createEstimateAtomic(input: CreateEstimateInput): Promise<CreateEstimateAtomicResult> {
    const client = this.clientFactory() as EstimateDatabaseClient;
    const branchId = input.branch_id ?? input.definition.branch_id ?? null;
    const { data, error } = await (client as any).rpc("create_estimate_atomic", {
      p_definition: {
        ...input.definition,
        branch_id: branchId,
        ...(input.conversion_request ? { conversion_request: input.conversion_request, source_fingerprint: input.source_fingerprint } : {}),
      },
      p_lines: input.lines.map((line) => {
        const discountAmount = line.discount_amount ?? 0;
        const rateListId = line.resolved_price?.rate_list_id ?? line.rate_list_id ?? null;
        const rateListVersionId = line.resolved_price?.rate_list_version_id ?? line.rate_list_version_id ?? null;
        return {
          ...line,
          rate_list_id: rateListId,
          rate_list_version_id: rateListVersionId,
          discount_amount: discountAmount,
          line_amount: line.quantity * line.unit_price - discountAmount,
          pricing_provenance: {
            product_id: line.product_id,
            rate_list_id: rateListId,
            rate_list_version_id: rateListVersionId,
            selection_source: line.rate_list_selection_source ?? "INHERITED",
            brand_hint: line.brand_hint ?? null,
            pricing_source: line.pricing_source,
            manual_unit_price: line.pricing_source === "MANUAL_OVERRIDE" ? line.unit_price : null,
            quantity: line.quantity,
            unit: line.unit,
            discount_amount: discountAmount,
            line_amount: line.quantity * line.unit_price - discountAmount,
            resolved_price: line.resolved_price ?? null,
          },
        };
      }),
      p_source_type: input.source_type ?? "MANUAL",
      p_source_reference: input.source_reference ?? null,
      p_branch_id: branchId,
      p_actor_user_id: input.actor_user_id ?? null,
      p_idempotency_key: input.idempotency_key ?? null,
    });
    if (error) {
      if (input.conversion_request && error.code === "40001") throw new ApiError(409, "PREVIEW_CHANGED", "Source or pricing changed; generate a new preview");
      if (input.conversion_request && error.code === "23505") throw new ApiError(409, "ESTIMATE_CONFLICT", "Estimate number or idempotency key conflicts with an existing request");
      throw error;
    }
    const payload = (Array.isArray(data) ? data[0] : data) as { estimate?: EstimateRecord; items?: EstimateItemRecord[] } | null;
    if (!payload?.estimate || !Array.isArray(payload.items)) {
      throw new Error("create_estimate_atomic returned an invalid response");
    }
    return { record: payload.estimate, items: payload.items };
  }

  async getEstimateAggregate(estimateId: number, organizationId: string): Promise<import("../services/estimate-clone-reprice.service.js").EstimateAggregate | null> {
    const { data, error } = await this.clientFactory().rpc("estimate_conversion_snapshot", { p_estimate_id: estimateId, p_organization_id: organizationId });
    if (error) throw error;
    return data;
  }

  async getConversionReplay(organizationId: string, actorId: string, key: string) {
    const { data, error } = await this.clientFactory().from("estimate_idempotency_keys").select("conversion_request,response_snapshot")
      .eq("organization_id", organizationId).eq("actor_user_id", actorId).eq("operation", "estimate.create").eq("idempotency_key", key).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (!data.response_snapshot) throw new Error("estimate request is still being processed");
    return { request: data.conversion_request, result: { record: data.response_snapshot.estimate as EstimateRecord, items: data.response_snapshot.items as EstimateItemRecord[], source_fingerprint: "" } };
  }
}
