import type { EstimateDocument } from "../types/estimate-document.types.js";
import { buildQuotationFromEstimate, type QuotationDefinition, type QuotationDocument } from "../types/quotation.types.js";

export interface QuotationRepository {
  createQuotation(quotation: QuotationDocument): Promise<QuotationDocument>;
}

export class DefaultQuotationService {
  constructor(private readonly repository: QuotationRepository) {}

  async convertEstimate(
    estimate: EstimateDocument,
    definition: QuotationDefinition,
  ): Promise<QuotationDocument> {
    if (estimate.status !== "READY") {
      throw new Error("only READY estimates can be converted to quotation");
    }
    if (estimate.id <= 0) throw new Error("estimate must have a persisted id");
    if (!definition.quotation_number.trim()) throw new Error("quotation_number is required");
    if (!Number.isInteger(definition.customer_id) || definition.customer_id <= 0) {
      throw new Error("customer_id must be a positive integer");
    }

    const draft = buildQuotationFromEstimate(estimate, definition);
    return this.repository.createQuotation(draft);
  }
}
