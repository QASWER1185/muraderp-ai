import type { EstimateDraft, EstimateDocument, EstimateTotals } from "../types/estimate-document.types.js";
import type { EstimateLineDraft, PricedEstimateLine } from "../types/estimate.types.js";
import type { CreateEstimateInput, EstimateRepository } from "../repositories/estimate.repository.js";
import type { PricingService } from "./pricing.service.js";
import { DefaultEstimatePricingService } from "./estimate-pricing.service.js";

export interface EstimateService {
  createDraft(draft: EstimateDraft, source?: Pick<CreateEstimateInput, "source_type" | "source_reference">): Promise<EstimateDocument>;
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function calculateTotals(lines: PricedEstimateLine[], passThroughRent = 0): EstimateTotals {
  if (!Number.isFinite(passThroughRent) || passThroughRent < 0) {
    throw new Error("pass_through_rent must be zero or greater");
  }

  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  const discount_total = 0;
  const grand_total = subtotal - discount_total;

  return {
    subtotal,
    discount_total,
    grand_total,
    customer_payable_total: grand_total + passThroughRent,
    pass_through_rent: passThroughRent,
  };
}

function validateLines(lines: EstimateLineDraft[]): void {
  if (lines.length === 0) throw new Error("estimate must contain at least one line");

  const lineNumbers = new Set<number>();
  for (const line of lines) {
    assertPositiveInteger(line.line_number, "line_number");
    if (lineNumbers.has(line.line_number)) {
      throw new Error(`duplicate line_number ${line.line_number}`);
    }
    lineNumbers.add(line.line_number);

    assertPositiveInteger(line.product_id, "product_id");
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error("quantity must be greater than zero");
    }
    if (line.unit_price !== undefined && (!Number.isFinite(line.unit_price) || line.unit_price < 0)) {
      throw new Error("unit_price must be zero or greater");
    }
    if (!line.unit.trim()) throw new Error("unit is required");
  }
}

export class DefaultEstimateService implements EstimateService {
  private readonly estimatePricingService: DefaultEstimatePricingService | undefined;

  constructor(
    private readonly repository: EstimateRepository,
    pricingService?: PricingService,
  ) {
    this.estimatePricingService = pricingService ? new DefaultEstimatePricingService(pricingService) : undefined;
  }

  async createDraft(
    draft: EstimateDraft,
    source: Pick<CreateEstimateInput, "source_type" | "source_reference"> = {},
  ): Promise<EstimateDocument> {
    assertPositiveInteger(draft.definition.customer_id, "customer_id");
    if (!draft.definition.estimate_number.trim()) throw new Error("estimate_number is required");
    if (!draft.definition.issue_date || Number.isNaN(Date.parse(draft.definition.issue_date))) {
      throw new Error("issue_date must be a valid date");
    }
    if (!draft.definition.currency_code.trim()) throw new Error("currency_code is required");
    if (draft.definition.default_rate_list_id != null) {
      assertPositiveInteger(draft.definition.default_rate_list_id, "default_rate_list_id");
    }
    if (draft.definition.pass_through_rent !== undefined && draft.definition.pass_through_rent < 0) {
      throw new Error("pass_through_rent must be zero or greater");
    }
    if (draft.definition.pass_through_rent && !draft.definition.pass_through_rent_payee?.trim()) {
      throw new Error("pass_through_rent_payee is required when pass_through_rent is provided");
    }
    validateLines(draft.lines);

    const lines: PricedEstimateLine[] = [];
    for (const line of draft.lines) {
      if (!this.estimatePricingService) {
        if (line.unit_price === undefined) {
          throw new Error(`unit_price is required when pricing service is not configured for line ${line.line_number}`);
        }
        lines.push({
          ...line,
          unit: line.unit.trim(),
          unit_price: line.unit_price,
          pricing_source: line.pricing_source ?? "MANUAL_OVERRIDE",
        });
        continue;
      }

      lines.push(await this.estimatePricingService.priceLine(line, {
        price_type: "SALE",
        as_of: draft.definition.issue_date,
        customer_id: draft.definition.customer_id,
        rate_list_id: draft.definition.default_rate_list_id ?? null,
      }));
    }

    const record = await this.repository.createEstimate({ definition: draft.definition, ...source, lines });
    for (const line of lines) {
      await this.repository.createEstimateItem(record.id, line);
    }

    return {
      id: record.id,
      status: record.status,
      definition: draft.definition,
      lines,
      totals: calculateTotals(lines, draft.definition.pass_through_rent ?? 0),
    };
  }
}
