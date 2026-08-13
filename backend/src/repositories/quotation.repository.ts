import { getSupabaseAdminClient } from "../config/supabase.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuotationDocument } from "../types/quotation.types.js";

type QuotationDatabaseClient = SupabaseClient & {
  from(table: "quotations" | "quotation_items"): any;
};

export interface QuotationRepository {
  createQuotation(quotation: QuotationDocument): Promise<QuotationDocument>;
}

export class SupabaseQuotationRepository implements QuotationRepository {
  constructor(private readonly clientFactory: () => SupabaseClient = getSupabaseAdminClient) {}

  async createQuotation(quotation: QuotationDocument): Promise<QuotationDocument> {
    const client = this.clientFactory() as QuotationDatabaseClient;
    const { data, error } = await client
      .from("quotations")
      .insert({
        source_estimate_id: quotation.source_estimate_id,
        customer_id: quotation.definition.customer_id,
        quotation_number: quotation.definition.quotation_number,
        issue_date: quotation.definition.issue_date,
        currency_code: quotation.definition.currency_code,
        status: quotation.status,
        notes: quotation.definition.notes ?? null,
        pass_through_rent: quotation.pass_through_rent,
      })
      .select()
      .single();

    if (error) throw error;
    const record = data as Record<string, unknown>;

    for (const line of quotation.lines) {
      const { error: itemError } = await client.from("quotation_items").insert({
        quotation_id: record.id,
        line_number: line.line_number,
        product_id: line.product_id,
        description: null,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unit_price,
        discount_amount: 0,
        pricing_source: line.pricing_source,
        rate_list_id: line.resolved_price?.rate_list_id ?? null,
        rate_list_version_id: line.resolved_price?.rate_list_version_id ?? null,
      });
      if (itemError) throw itemError;
    }

    return { ...quotation, id: Number(record.id) };
  }
}
