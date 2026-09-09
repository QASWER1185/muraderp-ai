import type { EstimateDocument } from "../types/estimate-document.types.js";
import {
  buildDirectInvoice,
  buildInvoiceFromEstimate,
  type InvoiceDefinition,
  type InvoiceDocument,
  type InvoiceTransactionResult,
} from "../types/invoice.types.js";
import type { EstimateLineDraft, EstimatePricingService, PricedEstimateLine } from "../types/estimate.types.js";

/**
 * Invoice creation is the user-facing sales action.
 * The transaction port performs all authoritative business effects atomically.
 * Direct Invoice pricing deliberately reuses the same pricing engine as Estimate,
 * so rate-list selection, per-line overrides, OCR brand hints and manual prices
 * behave identically in both documents.
 */
export interface InvoiceTransactionPort {
  execute(invoice: InvoiceDocument): Promise<InvoiceTransactionResult>;
}

export interface InvoicePricingContext {
  organization_id: string;
  price_type: "SALE";
  as_of: string;
  vendor_id?: number | null;
  customer_id?: number | null;
  rate_list_id?: number | null;
}

export class DefaultInvoiceService {
  constructor(private readonly transaction: InvoiceTransactionPort) {}

  async createFromEstimate(
    estimate: EstimateDocument,
    definition: InvoiceDefinition,
  ): Promise<InvoiceTransactionResult> {
    if (estimate.status !== "DRAFT" && estimate.status !== "READY") {
      throw new Error("only active estimates can be converted to invoice");
    }
    if (estimate.id <= 0) throw new Error("estimate must have a persisted id");
    return this.transaction.execute(buildInvoiceFromEstimate(estimate, definition));
  }

  async createDirect(
    definition: InvoiceDefinition,
    lines: PricedEstimateLine[],
    subtotal: number,
    discount_total: number,
    grand_total: number,
    pass_through_rent: number,
  ): Promise<InvoiceTransactionResult> {
    if (lines.length === 0) throw new Error("invoice must contain at least one line");
    return this.transaction.execute(
      buildDirectInvoice(definition, lines, subtotal, discount_total, grand_total, pass_through_rent),
    );
  }

  /**
   * Direct Invoice entry with the same three pricing modes supported by Estimate:
   * inherited/default rate list, per-line rate-list override/brand hint, or manual price.
   */
  async createDirectWithPricing(
    definition: InvoiceDefinition,
    lines: EstimateLineDraft[],
    pricing: EstimatePricingService,
    context: InvoicePricingContext,
    subtotal: number,
    discount_total: number,
    grand_total: number,
    pass_through_rent: number,
  ): Promise<InvoiceTransactionResult> {
    if (lines.length === 0) throw new Error("invoice must contain at least one line");

    const pricedLines: PricedEstimateLine[] = [];
    for (const line of lines) {
      pricedLines.push(await pricing.priceLine(line, context));
    }

    return this.transaction.execute(
      buildDirectInvoice(definition, pricedLines, subtotal, discount_total, grand_total, pass_through_rent),
    );
  }
}
