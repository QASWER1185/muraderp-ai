import type { EstimateDraft, EstimateDocument, EstimateTotals } from "../types/estimate-document.types.js";
import type { EstimateLineDraft, PricedEstimateLine, EstimatePricingService } from "../types/estimate.types.js";
import type { CreateEstimateInput, EstimateRepository } from "../repositories/estimate.repository.js";

export interface EstimateService {
  createDraft(
    draft: EstimateDraft,
    source?: Pick<CreateEstimateInput, "source_type" | "source_reference" | "branch_id" | "actor_user_id" | "idempotency_key">,
  ): Promise<EstimateDocument>;
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
}

function calculateTotals(lines: PricedEstimateLine[], passThroughRent = 0): EstimateTotals {
  if (!Number.isFinite(passThroughRent) || passThroughRent < 0) throw new Error("pass_through_rent must be zero or greater");
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  const discount_total = lines.reduce((sum, line) => sum + (line.discount_amount ?? 0), 0);
  const grand_total = subtotal - discount_total;
  return { subtotal, discount_total, grand_total, customer_payable_total: grand_total + passThroughRent, pass_through_rent: passThroughRent };
}

function validateLines(lines: PricedEstimateLine[]): void {
  if (lines.length === 0) throw new Error("estimate must contain at least one line");
  const lineNumbers = new Set<number>();
  for (const line of lines) {
    assertPositiveInteger(line.line_number, "line_number");
    if (lineNumbers.has(line.line_number)) throw new Error(`duplicate line_number ${line.line_number}`);
    lineNumbers.add(line.line_number);
    assertPositiveInteger(line.product_id, "product_id");
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new Error("quantity must be greater than zero");
    if (!Number.isFinite(line.unit_price) || line.unit_price < 0) throw new Error("unit_price must be zero or greater");
    const discount = line.discount_amount ?? 0;
    if (!Number.isFinite(discount) || discount < 0) throw new Error("discount_amount must be zero or greater");
    if (line.quantity * line.unit_price - discount < 0) throw new Error("discount_amount cannot exceed line total");
    if (!line.unit.trim()) throw new Error("unit is required");
  }
}

export class DefaultEstimateService implements EstimateService {
  constructor(private readonly repository: EstimateRepository, private readonly pricingService?: EstimatePricingService) {}

  async createDraft(
    draft: EstimateDraft,
    source: Pick<CreateEstimateInput, "source_type" | "source_reference" | "branch_id" | "actor_user_id" | "idempotency_key"> = {},
  ): Promise<EstimateDocument> {
    assertPositiveInteger(draft.definition.customer_id, "customer_id");
    if (!draft.definition.estimate_number.trim()) throw new Error("estimate_number is required");
    if (!draft.definition.issue_date || Number.isNaN(Date.parse(draft.definition.issue_date))) throw new Error("issue_date must be a valid date");
    if (!draft.definition.currency_code.trim()) throw new Error("currency_code is required");
    if (draft.definition.pass_through_rent !== undefined && draft.definition.pass_through_rent < 0) throw new Error("pass_through_rent must be zero or greater");
    if (draft.definition.pass_through_rent && !draft.definition.pass_through_rent_payee?.trim()) throw new Error("pass_through_rent_payee is required when pass_through_rent is provided");

    let pricedLines: PricedEstimateLine[] = draft.lines;
    if (this.pricingService) {
      pricedLines = await Promise.all(draft.lines.map(async (line) => {
        // A captured brand/company hint is not an instruction to use the
        // estimate default. It must be paired with an explicit line-level list.
        const selectedRateListId = line.rate_list_id ?? (line.brand_hint?.trim()
          ? null
          : draft.definition.default_rate_list_id ?? null);
        const candidate: EstimateLineDraft = selectedRateListId != null && line.rate_list_selection_source == null
          ? { ...line, rate_list_id: selectedRateListId, rate_list_selection_source: "ESTIMATE_DEFAULT" }
          : selectedRateListId != null
            ? { ...line, rate_list_id: selectedRateListId }
            : { ...line };
        return this.pricingService!.priceLine(candidate, {
          organization_id: draft.definition.organization_id,
          price_type: "SALE",
          as_of: draft.definition.issue_date,
          customer_id: draft.definition.customer_id,
        });
      }));
    }

    validateLines(pricedLines);
    const input: CreateEstimateInput = { definition: draft.definition, ...source, lines: pricedLines };
    if (!this.repository.createEstimateAtomic) {
      throw new Error("atomic estimate repository operation is required");
    }
    const { record } = await this.repository.createEstimateAtomic(input);

    return {
      id: record.id,
      status: record.status,
      definition: draft.definition,
      lines: pricedLines,
      totals: calculateTotals(pricedLines, draft.definition.pass_through_rent ?? 0),
    };
  }
}
