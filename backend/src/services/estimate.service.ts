import type { EstimateDraft, EstimateDocument, EstimateTotals } from "../types/estimate-document.types.js";
import type { PricedEstimateLine } from "../types/estimate.types.js";
import type { CreateEstimateInput, EstimateRepository } from "../repositories/estimate.repository.js";

export interface EstimateService {
  createDraft(draft: EstimateDraft, source?: Pick<CreateEstimateInput, "source_type" | "source_reference">): Promise<EstimateDocument>;
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function calculateTotals(lines: PricedEstimateLine[]): EstimateTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  const discount_total = 0;
  return {
    subtotal,
    discount_total,
    grand_total: subtotal - discount_total,
  };
}

function validateLines(lines: PricedEstimateLine[]): void {
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
    if (!Number.isFinite(line.unit_price) || line.unit_price < 0) {
      throw new Error("unit_price must be zero or greater");
    }
    if (!line.unit.trim()) throw new Error("unit is required");
  }
}

export class DefaultEstimateService implements EstimateService {
  constructor(private readonly repository: EstimateRepository) {}

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
    validateLines(draft.lines);

    const record = await this.repository.createEstimate({ definition: draft.definition, ...source, lines: draft.lines });
    const persistedLines = [];
    for (const line of draft.lines) {
      persistedLines.push(await this.repository.createEstimateItem(record.id, line));
    }

    return {
      id: record.id,
      status: record.status,
      definition: draft.definition,
      lines: draft.lines,
      totals: calculateTotals(draft.lines),
    };
  }
}
