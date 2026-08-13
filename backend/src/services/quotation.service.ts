import type { EstimateDocument } from "../types/estimate-document.types.js";
import type { QuotationDefinition, QuotationDocument } from "../types/quotation.types.js";

/**
 * Compatibility facade only. Estimate and Quotation are one domain object.
 * The UI may label the same document "Estimate" or "Quotation" without
 * creating a second commercial record.
 */
export interface QuotationRepository {
  saveEstimate(estimate: EstimateDocument): Promise<EstimateDocument>;
}

export class DefaultQuotationService {
  constructor(private readonly repository: QuotationRepository) {}

  async convertEstimate(
    estimate: EstimateDocument,
    _definition?: QuotationDefinition,
  ): Promise<QuotationDocument> {
    if (estimate.status !== "READY") {
      throw new Error("only READY estimates can be issued as quotation");
    }
    if (estimate.id <= 0) throw new Error("estimate must have a persisted id");

    return this.repository.saveEstimate(estimate);
  }
}
